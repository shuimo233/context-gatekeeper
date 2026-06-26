/**
 * Cline adapter.
 *
 * Cline reads MCP server configs from VSCode workspace settings. This adapter
 * uses the Cline CLI (`cline`) when available, falling back to a direct MCP
 * stdio invocation. The MCP server configuration shape matches what Cline
 * generates internally.
 */

import { BaseAgentAdapter, AgentConfig } from './base.ts';

export class ClineAdapter extends BaseAgentAdapter {
  override get name(): string {
    return 'cline';
  }

  override buildSpawnCommand(): { command: string; args: string[]; env: Record<string, string | undefined> } {
    const cliPath = this.config.cliPath ?? 'cline';
    const prompt = this.config.cliArgs?.[0] ?? 'noop';
    return {
      command: cliPath,
      args: ['--mcp-config', this.mcpConfigPath, '--prompt', prompt, '--output', 'json'],
      env: this.buildMcpServerEnv(),
    };
  }

  static buildMcpConfig(mcpBin: { command: string; args: string[] }): AgentConfig['mcpConfig'] {
    return {
      mcpServers: {
        'context-gatekeeper': {
          command: mcpBin.command,
          args: mcpBin.args,
          disabled: false,
        },
      },
    };
  }
}