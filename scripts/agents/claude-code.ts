/**
 * Claude Code adapter.
 *
 * Claude Code reads `.mcp.json` from the project root. This adapter uses the
 * same configuration shape and validates that the MCP server is discoverable
 * by spawning it directly.
 */

import { BaseAgentAdapter, AgentConfig } from './base.ts';

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  override get name(): string {
    return 'claude-code';
  }

  override buildSpawnCommand(): { command: string; args: string[]; env: Record<string, string | undefined> } {
    const cliPath = this.config.cliPath ?? 'claude';
    return {
      command: cliPath,
      args: ['--mcp-config', this.mcpConfigPath, '--print', 'noop'],
      env: this.buildMcpServerEnv(),
    };
  }

  static buildMcpConfig(mcpBin: { command: string; args: string[] }): AgentConfig['mcpConfig'] {
    return {
      mcpServers: {
        'context-gatekeeper': {
          command: mcpBin.command,
          args: mcpBin.args,
          type: 'stdio',
        },
      },
    };
  }
}