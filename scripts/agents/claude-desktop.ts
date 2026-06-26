/**
 * Claude Desktop adapter.
 *
 * Claude Desktop reads `~/Library/Application Support/Claude/claude_desktop_config.json`
 * on macOS or `%APPDATA%/Claude/claude_desktop_config.json` on Windows.
 *
 * This adapter uses the same JSON shape and the same stdio-based MCP server
 * contract that Claude Desktop launches. The adapter additionally exercises
 * the optional `claude` CLI for headless smoke testing when available.
 */

import { BaseAgentAdapter, AgentConfig } from './base.ts';

export class ClaudeDesktopAdapter extends BaseAgentAdapter {
  override get name(): string {
    return 'claude-desktop';
  }

  override buildSpawnCommand(): { command: string; args: string[]; env: Record<string, string | undefined> } {
    const cg = this.getMcpServerCommand();
    return {
      command: cg.command,
      args: cg.args,
      env: this.buildMcpServerEnv(),
    };
  }

  /** Build the standard `claude_desktop_config.json` shape. */
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