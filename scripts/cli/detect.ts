/**
 * Agent config-file path detection.
 *
 * Each supported MCP agent has its own global config path (and most also
 * support a project-local override). This module maps agent names to the
 * absolute path of the config file the agent will actually read, taking
 * the current platform into account.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type AgentName = 'cursor' | 'claude-desktop' | 'cline' | 'continue' | 'claude-code';

export type Scope = 'global' | 'project';

export interface AgentDetection {
  agent: AgentName;
  scope: Scope;
  configPath: string;
  exists: boolean;
  /** True if the config file already references context-gatekeeper. */
  installed: boolean;
}

interface PathSpec {
  win: () => string;
  posix: () => string;
}

function appDataWindows(): string {
  return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
}

/**
 * Path specs for each agent's *global* config file.
 * Project-level paths (workspace-local) are resolved by the caller.
 */
const GLOBAL_PATHS: Record<AgentName, PathSpec> = {
  cursor: {
    win: () => join(homedir(), '.cursor', 'mcp.json'),
    posix: () => join(homedir(), '.cursor', 'mcp.json'),
  },
  'claude-desktop': {
    win: () => join(appDataWindows(), 'Claude', 'claude_desktop_config.json'),
    posix: () => join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
  },
  cline: {
    win: () => join(homedir(), '.vscode', 'mcp.json'),
    posix: () => join(homedir(), '.vscode', 'mcp.json'),
  },
  continue: {
    win: () => join(appDataWindows(), 'continue', 'config.json'),
    posix: () => join(homedir(), '.continue', 'config.json'),
  },
  'claude-code': {
    win: () => join(homedir(), '.mcp.json'),
    posix: () => join(homedir(), '.mcp.json'),
  },
};

function pickGlobalPath(agent: AgentName): string {
  const spec = GLOBAL_PATHS[agent];
  return process.platform === 'win32' ? spec.win() : spec.posix();
}

function pickProjectPath(agent: AgentName, cwd: string): string | null {
  // Claude Desktop is global-only.
  if (agent === 'claude-desktop') return null;
  switch (agent) {
    case 'cursor':
      return join(cwd, '.cursor', 'mcp.json');
    case 'cline':
      return join(cwd, '.vscode', 'mcp.json');
    case 'continue':
      return join(cwd, '.continue', 'config.json');
    case 'claude-code':
      return join(cwd, '.mcp.json');
  }
}

export const SUPPORTED_AGENTS: AgentName[] = [
  'cursor',
  'claude-desktop',
  'cline',
  'continue',
  'claude-code',
];

export function isValidAgent(name: string): name is AgentName {
  return (SUPPORTED_AGENTS as string[]).includes(name);
}

/**
 * Detect where the agent's config file lives. Prefers project-level when
 * `scope === 'project'`, otherwise global. If `scope` is omitted, returns
 * the path that exists (or would be written), preferring project-level.
 */
export function detectAgent(
  agent: AgentName,
  options: { scope?: Scope; cwd?: string } = {},
): AgentDetection {
  const cwd = options.cwd ?? process.cwd();
  const scope: Scope = options.scope ?? 'global';

  const configPath =
    scope === 'project'
      ? pickProjectPath(agent, cwd) ?? pickGlobalPath(agent)
      : pickGlobalPath(agent);

  const exists = existsSync(configPath);
  const installed = exists && configContainsGatekeeper(configPath);

  return { agent, scope, configPath, exists, installed };
}

/**
 * Probe all supported agents for their detection state.
 */
export function detectAll(options: { scope?: Scope; cwd?: string } = {}): AgentDetection[] {
  return SUPPORTED_AGENTS.map((a) => detectAgent(a, options));
}

/**
 * Filter a list of detections to those whose config file currently exists.
 * Used by `--all` to skip agents that are not installed on this machine.
 */
export function filterDetected(detections: AgentDetection[]): AgentDetection[] {
  return detections.filter((d) => d.exists);
}

/**
 * Cheap heuristic check: read the file and see if "context-gatekeeper"
 * appears as a key in the `mcpServers` map or as an entry in
 * `experimental.modelContextProtocolServers`.
 */
function configContainsGatekeeper(filePath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  const servers = obj.mcpServers as Record<string, unknown> | undefined;
  if (servers && typeof servers === 'object' && 'context-gatekeeper' in servers) {
    return true;
  }
  const exp = obj.experimental as { modelContextProtocolServers?: Array<{ name?: string }> } | undefined;
  if (exp?.modelContextProtocolServers?.some((s) => s.name === 'context-gatekeeper')) {
    return true;
  }
  return false;
}