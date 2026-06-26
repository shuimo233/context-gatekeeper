/**
 * Continue adapter.
 *
 * Continue.dev reads `.continue/config.json`. This adapter exercises the same
 * MCP server configuration shape that Continue uses (`experimental.modelContextProtocolServers`).
 */

import { BaseAgentAdapter, AgentConfig } from './base.ts';

export class ContinueAdapter extends BaseAgentAdapter {
  override get name(): string {
    return 'continue';
  }

  override buildSpawnCommand(): { command: string; args: string[]; env: Record<string, string | undefined> } {
    const cliPath = this.config.cliPath ?? 'cn';
    return {
      command: cliPath,
      args: ['--config', this.mcpConfigPath, 'test-mcp'],
      env: this.buildMcpServerEnv(),
    };
  }

  static buildMcpConfig(mcpBin: { command: string; args: string[] }): AgentConfig['mcpConfig'] {
    return {
      experimental: {
        modelContextProtocolServers: [
          {
            name: 'context-gatekeeper',
            command: mcpBin.command,
            args: mcpBin.args,
            transport: 'stdio',
          },
        ],
      },
    };
  }
}