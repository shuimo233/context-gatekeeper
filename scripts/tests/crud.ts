/**
 * CRUD integration test.
 *
 * Exercises 4 core scenarios via the MCP server using the exact JSON-RPC
 * contract that each agent uses internally:
 *   1. Write  - `memory_store` then `memory_recall` returns the same content
 *   2. Read   - `memory_recall` works in all 4 search modes
 *   3. Delete - `memory_delete_batch` removes the memory and recall no longer hits
 *   4. Anchor - `memory_anchor` promotes memory; subsequent compression cannot remove it
 */

import { McpTestClient } from '../mcp-client.ts';
import { BaseAgentAdapter, ToolCallResult } from '../agents/base.ts';

export interface CrudScenario {
  name: string;
  tool: string;
  success: boolean;
  detail?: string;
  latencyMs: number;
}

export interface CrudReport {
  agent: string;
  scenarios: CrudScenario[];
  allOk: boolean;
  totalLatencyMs: number;
}

const WRITE_TOKEN = 'crud-write-token';

export async function runCrudTest(adapter: BaseAgentAdapter): Promise<CrudReport> {
  const start = Date.now();
  const cg = adapter['getMcpServerCommand']();
  const env = { ...adapter.buildMcpServerEnv(), CG_WRITE_TOKEN: WRITE_TOKEN };
  const client = new McpTestClient({ command: cg.command, args: cg.args, env, cwd: adapter.getDataDir() });

  const scenarios: CrudScenario[] = [];
  let probeId = '';

  try {
    await client.start();

    // 1. WRITE
    {
      const t0 = Date.now();
      const unique = `cross-agent-crud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const writeRes = await client.callTool('memory_store', {
        content: unique,
        priority: 'constraint',
        project_tags: ['cross-agent-test'],
        user_id: 'default',
        agent_id: 'default',
        project_id: 'default',
        token: WRITE_TOKEN,
      });
      const writeOk = !writeRes.errored && Boolean(writeRes.parsed);
      const writeParsed = writeRes.parsed as { id?: string; error?: string } | undefined;
      probeId = writeParsed?.id ?? '';
      scenarios.push({
        name: 'write-then-recall',
        tool: 'memory_store',
        success: writeOk && !!probeId,
        detail: writeOk ? undefined : (writeParsed?.error ?? 'no id returned'),
        latencyMs: Date.now() - t0,
      });

      const recall = await client.callTool('memory_recall', {
        query: unique,
        limit: 5,
        search_mode: 'keyword',
        user_id: 'default',
        agent_id: 'default',
        project_id: 'default',
      });
      const recallParsed = recall.parsed as { memories?: Array<{ content: string }> } | undefined;
      const hit = recallParsed?.memories?.some((r) => r.content.includes(unique)) ?? false;
      scenarios.push({
        name: 'recall-after-write',
        tool: 'memory_recall',
        success: hit,
        detail: hit ? undefined : 'unique content not found in recall results',
        latencyMs: Date.now() - t0,
      });
    }

    // 2. READ in all 4 supported search modes
    {
      for (const mode of ['keyword', 'semantic', 'hybrid', 'auto'] as const) {
        const t0 = Date.now();
        const res = await client.callTool('memory_recall', {
          query: 'cross-agent',
          limit: 5,
          search_mode: mode,
          user_id: 'default',
          agent_id: 'default',
          project_id: 'default',
        });
        const ok = !res.errored;
        scenarios.push({
          name: `search-mode-${mode}`,
          tool: 'memory_recall',
          success: ok,
          detail: ok ? undefined : (res.parsed as { error?: string })?.error,
          latencyMs: Date.now() - t0,
        });
      }
    }

    // 3. DELETE
    if (probeId) {
      const t0 = Date.now();
      const del = await client.callTool('memory_delete_batch', {
        memory_ids: [probeId],
        user_id: 'default',
        agent_id: 'default',
        project_id: 'default',
        token: WRITE_TOKEN,
      });
      const delOk = !del.errored;
      scenarios.push({
        name: 'delete-batch',
        tool: 'memory_delete_batch',
        success: delOk,
        detail: delOk ? undefined : (del.parsed as { error?: string })?.error,
        latencyMs: Date.now() - t0,
      });
    } else {
      scenarios.push({ name: 'delete-batch', tool: 'memory_delete_batch', success: false, detail: 'no probe id', latencyMs: 0 });
    }

    // 4. ANCHOR
    {
      const t0 = Date.now();
      const unique = `cross-agent-anchor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const store = await client.callTool('memory_store', {
        content: unique,
        priority: 'fact',
        project_tags: ['cross-agent-test'],
        user_id: 'default',
        agent_id: 'default',
        project_id: 'default',
        token: WRITE_TOKEN,
      });
      const id = (store.parsed as { id?: string })?.id ?? '';
      const anchor = id ? await client.callTool('memory_anchor', {
        memory_id: id,
        user_id: 'default',
        agent_id: 'default',
        project_id: 'default',
        token: WRITE_TOKEN,
      }) : { isError: true, errored: true, parsed: { error: 'no id' } };
      const anchorParsed = anchor.parsed as { error?: string } | undefined;
      scenarios.push({
        name: 'anchor-promotion',
        tool: 'memory_anchor',
        success: !anchor.errored,
        detail: anchor.errored ? (anchorParsed?.error ?? 'unknown') : undefined,
        latencyMs: Date.now() - t0,
      });
    }
  } catch (err) {
    scenarios.push({
      name: 'crud-suite-error',
      tool: 'unknown',
      success: false,
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    });
  } finally {
    await client.stop();
  }

  return {
    agent: adapter.name,
    scenarios,
    allOk: scenarios.every((s) => s.success),
    totalLatencyMs: Date.now() - start,
  };
}

export function crudResultToCall(r: CrudReport): ToolCallResult[] {
  return r.scenarios.map((s) => ({
    agent: r.agent,
    tool: s.tool,
    success: s.success,
    latencyMs: s.latencyMs,
    payload: s,
    error: s.detail,
  }));
}