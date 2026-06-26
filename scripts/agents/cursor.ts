/**
 * Cursor adapter.
 *
 * Cursor reads `.cursor/mcp.json` from the workspace root and uses the
 * `context-gatekeeper` server definition. This adapter exercises the same
 * configuration shape that Cursor itself reads: the MCP server binary is
 * invoked via stdio using the exact command/args Cursor would use.
 *
 * Since the Cursor desktop app is not scriptable in this environment, the
 * adapter instead spawns the MCP server with the same stdio contract Cursor
 * uses and validates the JSON-RPC handshake against the SDK reference client.
 */

import { BaseAgentAdapter, AgentConfig } from './base.ts';

export class CursorAdapter extends BaseAgentAdapter {
  override get name(): string {
    return 'cursor';
  }

  override buildSpawnCommand(): { command: string; args: string[]; env: Record<string, string | undefined> } {
    const cg = this.getMcpServerCommand();
    return {
      command: cg.command,
      args: cg.args,
      env: this.buildMcpServerEnv(),
    };
  }

  /** Build the standard `.cursor/mcp.json` configuration for documentation purposes. */
  static buildMcpConfig(mcpBin: { command: string; args: string[] }): AgentConfig['mcpConfig'] {
    return {
      mcpServers: {
        'context-gatekeeper': {
          command: mcpBin.command,
          args: mcpBin.args,
        },
      },
    };
  }
}