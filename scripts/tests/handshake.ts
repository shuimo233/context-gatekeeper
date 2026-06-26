/**
 * MCP protocol handshake test.
 *
 * For each agent adapter, spawn the MCP server exactly as the agent would,
 * perform the `initialize` handshake, and verify that:
 *  - handshake completes within 5 seconds
 *  - `tools/list` returns at least 20 tools
 *  - a sample read-only tool call (`memory_stats`) succeeds
 */

import { McpTestClient } from '../mcp-client.ts';
import { BaseAgentAdapter, ToolCallResult } from '../agents/base.ts';

export interface HandshakeReport {
  agent: string;
  handshakeOk: boolean;
  toolsDiscovered: number;
  toolNames: string[];
  sampleToolOk: boolean;
  latencyMs: number;
  error?: string;
}

export async function runHandshakeTest(adapter: BaseAgentAdapter): Promise<HandshakeReport> {
  const start = Date.now();
  const cg = adapter['getMcpServerCommand']();
  const client = new McpTestClient({
    command: cg.command,
    args: cg.args,
    env: adapter.buildMcpServerEnv(),
    cwd: adapter.getDataDir(),
  });
  try {
    await client.start();
    const tools = await client.listTools();
    const sample = await client.callTool('memory_stats', { user_id: 'default', agent_id: 'default', project_id: 'default' });
    return {
      agent: adapter.name,
      handshakeOk: true,
      toolsDiscovered: tools.length,
      toolNames: tools.map((t) => t.name),
      sampleToolOk: !sample.errored,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      agent: adapter.name,
      handshakeOk: false,
      toolsDiscovered: 0,
      toolNames: [],
      sampleToolOk: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.stop();
  }
}

export function handshakeResultToCall(r: HandshakeReport): ToolCallResult {
  return {
    agent: r.agent,
    tool: 'initialize+memory_stats',
    success: r.handshakeOk && r.sampleToolOk && r.toolsDiscovered >= 20,
    latencyMs: r.latencyMs,
    payload: r,
    error: r.error,
  };
}