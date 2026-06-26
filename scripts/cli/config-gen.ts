/**
 * Build the MCP config block that will be merged into the user's agent
 * config file. This is a thin wrapper that picks the right adapter for
 * the target agent and forwards a fixed `mcpBin` pointing at the
 * published npm package.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';

import { AgentName } from './detect.ts';
import { CursorAdapter } from '../agents/cursor.ts';
import { ClaudeDesktopAdapter } from '../agents/claude-desktop.ts';
import { ClineAdapter } from '../agents/cline.ts';
import { ContinueAdapter } from '../agents/continue.ts';
import { ClaudeCodeAdapter } from '../agents/claude-code.ts';
import type { AgentConfig } from '../agents/base.ts';

/**
 * `createRequire` from `node:module` is the canonical way to use CJS
 * `require()` from ESM sources. Direct `require('node:fs')` works in CJS
 * but throws `require is not defined` when this file is loaded via
 * tsx/Node's ESM loader (which is the path used by `scripts/cli.ts`).
 */
const cjs = createRequire(import.meta.url);
const childProcess = cjs('node:child_process') as typeof import('node:child_process');

/**
 * Resolve an absolute, system-level `node` binary path. Cursor ships its
 * own bundled node at `resources/helpers/node.exe`; we want to avoid
 * baking that path into a user's `mcp.json`, because:
 *   1. It pins the install to this specific Cursor install directory.
 *   2. The bundled node lacks a few npm modules a published
 *      context-gatekeeper may rely on (e.g. sql.js native bindings).
 *
 * Strategy: parse `where node` (Windows) or `which node` (POSIX) and
 * take the first result that is NOT the Cursor bundle. Fall back to
 * `process.execPath` only if both lookups fail — for non-Windows or
 * when no `where`/`which` is available (rare).
 */
function resolveSystemNode(): string {
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'where node' : 'which node';
  try {
    const out = childProcess.execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // Reject anything that lives under Cursor's installation.
    const nonCursor = lines.find((p) => !/cursor/i.test(p) && !/helpers\/node(\.exe)?$/i.test(p));
    if (nonCursor) return nonCursor;
    if (lines.length > 0) return lines[0];
  } catch {
    // `where`/`which` failed; fall through to the safe default below.
  }
  // As a last resort, use this process's node. On POSIX this is correct;
  // on Windows it may be the Cursor bundle, but at that point the user
  // likely has no system node at all and this is the best we can do.
  return process.execPath;
}

/**
 * Resolve the absolute path to the *published* context-gatekeeper's
 * `dist/mcp/server.js`. We rely on `npm root -g` because the recommended
 * install path for end users is `npm i -g context-gatekeeper`, which
 * puts a real directory under the global modules root.
 *
 * Returns `null` when no global install exists (e.g. the user has only
 * run the package from source). Callers fall back to `npx` in that case.
 */
function resolveGlobalServerBin(): string | null {
  try {
    const root = childProcess.execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const pkgRoot = resolvePath(root, PUBLISHED_PACKAGE);
    const pkgJsonPath = join(pkgRoot, 'package.json');
    if (!existsSync(pkgJsonPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      name?: string;
      bin?: Record<string, string>;
    };
    if (pkg.name !== PUBLISHED_PACKAGE) return null;
    const relBin = pkg.bin?.[PUBLISHED_PACKAGE];
    if (!relBin) return null;
    return resolvePath(pkgRoot, relBin);
  } catch (err) {
    console.error('[config-gen] resolveGlobalServerBin failed:', (err as Error).message);
    return null;
  }
}

/**
 * Build the launch command the user's agent will run to start the MCP
 * server. The form is platform-aware and depends on whether the package
 * has been globally installed:
 *
 *  - Global install present (any platform):
 *      command = <absolute path to system node>
 *      args    = [<absolute path to dist/mcp/server.js>]
 *    This avoids the `npx` dance entirely, sidesteps the Windows
 *    npx-cli.js relative-path bug, and does not require network access.
 *
 *  - No global install (e.g. running from source only):
 *      POSIX: `npx -y context-gatekeeper`
 *      Windows: `cmd /c npx -y context-gatekeeper`
 *    This is a fallback that only works once the package is published
 *    to a registry the host can reach.
 */
export function buildMcpBin(): { command: string; args: string[] } {
  const globalBin = resolveGlobalServerBin();
  if (globalBin) {
    return { command: resolveSystemNode(), args: [globalBin] };
  }
  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'npx', '-y', PUBLISHED_PACKAGE] };
  }
  return { command: 'npx', args: ['-y', PUBLISHED_PACKAGE] };
}

export const PUBLISHED_PACKAGE = 'context-gatekeeper';

/**
 * The launch command the user's agent will run to start the MCP server.
 * Computed at import time via {@link buildMcpBin}. Kept as a constant
 * for backward compatibility with code that still imports it; new code
 * should call `buildMcpBin()` directly.
 */
export const PUBLISHED_MCP_BIN: { command: string; args: string[] } = buildMcpBin();

/** Map agent name to the adapter class whose `buildMcpConfig` we want. */
function pickAdapter(agent: AgentName): (mcpBin: { command: string; args: string[] }) => AgentConfig['mcpConfig'] {
  switch (agent) {
    case 'cursor':
      return CursorAdapter.buildMcpConfig.bind(CursorAdapter);
    case 'claude-desktop':
      return ClaudeDesktopAdapter.buildMcpConfig.bind(ClaudeDesktopAdapter);
    case 'cline':
      return ClineAdapter.buildMcpConfig.bind(ClineAdapter);
    case 'continue':
      return ContinueAdapter.buildMcpConfig.bind(ContinueAdapter);
    case 'claude-code':
      return ClaudeCodeAdapter.buildMcpConfig.bind(ClaudeCodeAdapter);
  }
}

/**
 * Build the config block for a given agent. The result is a partial config
 * object (e.g. `{ mcpServers: { 'context-gatekeeper': {...} } }`) that will
 * be merged into the existing file.
 */
export function buildConfigBlock(agent: AgentName): AgentConfig['mcpConfig'] {
  return pickAdapter(agent)(PUBLISHED_MCP_BIN);
}

/**
 * The key the agent stores our server under. Used by install/uninstall
 * to find and remove the entry. The value is the same regardless of
 * agent because we always register under the canonical
 * `context-gatekeeper` name.
 *
 * - Cursor / Claude Desktop / Cline / Claude Code: top-level key under
 *   `mcpServers`.
 * - Continue: entry inside `experimental.modelContextProtocolServers`,
 *   identified by the entry's `name` field (not a key).
 */
export const GATEKEEPER_KEY = 'context-gatekeeper';