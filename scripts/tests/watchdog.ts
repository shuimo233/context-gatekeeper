/**
 * Watchdog token permission matrix test.
 *
 * For each agent, spawn the MCP server with a specific token configuration
 * and verify the read/write/watchdog permission matrix:
 *
 *   no token       -> read OK, write DENIED
 *   read token     -> read OK, write DENIED
 *   write token    -> read OK, write OK
 *   watchdog token -> read OK, write OK
 *
 * Tools used:
 *   read  probe = `memory_stats` (requires no token, but checks read access)
 *   write probe = `memory_store` (requires write token)
 */

import { McpTestClient } from '../mcp-client.ts';
import { BaseAgentAdapter, ToolCallResult } from '../agents/base.ts';

type Mode = 'no-token-strict' | 'read-token' | 'write-token' | 'watchdog-token';

export interface WatchdogCell {
  mode: Mode;
  readAllowed: boolean;
  writeAllowed: boolean;
  ok: boolean;
}

export interface WatchdogReport {
  agent: string;
  cells: WatchdogCell[];
  allOk: boolean;
  latencyMs: number;
}

const READ_TOKEN = 'wd-read-token';
const WRITE_TOKEN = 'wd-write-token';
const WATCHDOG_TOKEN = 'wd-watchdog-token';

/**
 * Expected behavior when CG_*_TOKEN env vars ARE configured (strict mode).
 * The product intentionally falls back to a permissive mode when no token
 * env vars are set, so the `no-token-strict` cell only applies if the
 * server is launched with at least one token env var.
 */
function expectedStrict(mode: Mode): { readAllowed: boolean; writeAllowed: boolean } {
  switch (mode) {
    case 'no-token-strict': return { readAllowed: true,  writeAllowed: false };
    case 'read-token':      return { readAllowed: true,  writeAllowed: false };
    case 'write-token':     return { readAllowed: true,  writeAllowed: true  };
    case 'watchdog-token':  return { readAllowed: true,  writeAllowed: true  };
  }
}

async function probeOne(
  adapter: BaseAgentAdapter,
  mode: Mode,
): Promise<WatchdogCell> {
  const env: Record<string, string | undefined> = { ...adapter.buildMcpServerEnv() };
  // Always inject all token env vars so the server runs in strict mode.
  env.CG_READ_TOKEN = READ_TOKEN;
  env.CG_WRITE_TOKEN = WRITE_TOKEN;
  env.CG_WATCHDOG_TOKEN = WATCHDOG_TOKEN;

  // Determine which token to pass with the call itself.
  let tokenToPass: string;
  if (mode === 'no-token-strict') {
    tokenToPass = '';
  } else if (mode === 'read-token') {
    tokenToPass = READ_TOKEN;
  } else if (mode === 'write-token') {
    tokenToPass = WRITE_TOKEN;
  } else {
    tokenToPass = WATCHDOG_TOKEN;
  }

  const cg = adapter['getMcpServerCommand']();
  const client = new McpTestClient({ command: cg.command, args: cg.args, env, cwd: adapter.getDataDir() });
  try {
    await client.start();
    const readProbe = await client.callTool('memory_stats', {
      user_id: 'default', agent_id: 'default', project_id: 'default',
    });
    const readAllowed = !readProbe.errored;

    const writeProbe = await client.callTool('memory_store', {
      content: `watchdog-probe-${Date.now()}`,
      priority: 'fact',
      project_tags: ['watchdog-test'],
      user_id: 'default', agent_id: 'default', project_id: 'default',
      token: tokenToPass,
    });
    // The server signals permission denied via `{ error: 'Permission denied' }`
    // in the content text payload rather than the MCP `isError` flag, so we
    // must inspect the parsed body to detect denials.
    const writeParsed = writeProbe.parsed as { error?: string } | undefined;
    const writeDenied = Boolean(writeParsed?.error);
    const writeAllowed = !writeProbe.errored && !writeDenied;

    const exp = expectedStrict(mode);
    const ok = readAllowed === exp.readAllowed && writeAllowed === exp.writeAllowed;
    return { mode, readAllowed, writeAllowed, ok };
  } finally {
    await client.stop();
  }
}

export async function runWatchdogTest(adapter: BaseAgentAdapter): Promise<WatchdogReport> {
  const start = Date.now();
  const cells: WatchdogCell[] = [];
  for (const mode of ['no-token-strict', 'read-token', 'write-token', 'watchdog-token'] as const) {
    cells.push(await probeOne(adapter, mode));
  }
  return {
    agent: adapter.name,
    cells,
    allOk: cells.every((c) => c.ok),
    latencyMs: Date.now() - start,
  };
}

export function watchdogResultToCalls(r: WatchdogReport): ToolCallResult[] {
  return r.cells.map((c) => ({
    agent: r.agent,
    tool: `watchdog[${c.mode}]`,
    success: c.ok,
    latencyMs: 0,
    payload: c,
    error: c.ok ? undefined : `expected read=${expectedStrict(c.mode).readAllowed},got=${c.readAllowed}; write=${expectedStrict(c.mode).writeAllowed},got=${c.writeAllowed}`,
  }));
}