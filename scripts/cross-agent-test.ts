#!/usr/bin/env node
/**
 * Cross-agent compatibility test runner.
 *
 * Usage:
 *   npx tsx scripts/cross-agent-test.ts [agent1 agent2 ...]
 *
 * If no agents are specified, runs all 5 adapters:
 *   cursor, claude-desktop, cline, continue, claude-code
 *
 * Outputs:
 *   scripts/reports/report-<timestamp>.json
 *   scripts/reports/report-<timestamp>.md
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BaseAgentAdapter, resolveMcpServerBin, AgentConfig, ToolCallResult } from './agents/base.ts';
import { CursorAdapter } from './agents/cursor.ts';
import { ClaudeDesktopAdapter } from './agents/claude-desktop.ts';
import { ClineAdapter } from './agents/cline.ts';
import { ContinueAdapter } from './agents/continue.ts';
import { ClaudeCodeAdapter } from './agents/claude-code.ts';
import { runHandshakeTest, handshakeResultToCall } from './tests/handshake.ts';
import { runCrudTest, crudResultToCall } from './tests/crud.ts';
import { runAfterChainTest, afterChainResultToCall } from './tests/after-chain.ts';
import { runWatchdogTest, watchdogResultToCalls } from './tests/watchdog.ts';
import { RunSummary, writeJsonReport, writeMarkdownReport } from './reporters/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORTS_DIR = join(__dirname, 'reports');

function buildAdapters(mcpBin: { command: string; args: string[] }): BaseAgentAdapter[] {
  const make = (
    AdapterCls: new (cfg: AgentConfig) => BaseAgentAdapter,
    mcpConfig: AgentConfig['mcpConfig'],
  ): BaseAgentAdapter => new AdapterCls({ name: new AdapterCls({ name: 'x', mcpConfig }).name, mcpConfig });

  return [
    new CursorAdapter({ name: 'cursor', mcpConfig: CursorAdapter.buildMcpConfig(mcpBin) }),
    new ClaudeDesktopAdapter({ name: 'claude-desktop', mcpConfig: ClaudeDesktopAdapter.buildMcpConfig(mcpBin) }),
    new ClineAdapter({ name: 'cline', mcpConfig: ClineAdapter.buildMcpConfig(mcpBin) }),
    new ContinueAdapter({ name: 'continue', mcpConfig: ContinueAdapter.buildMcpConfig(mcpBin) }),
    new ClaudeCodeAdapter({ name: 'claude-code', mcpConfig: ClaudeCodeAdapter.buildMcpConfig(mcpBin) }),
  ];
}

function filterByName(adapters: BaseAgentAdapter[], names: string[]): BaseAgentAdapter[] {
  if (names.length === 0) return adapters;
  return adapters.filter((a) => names.includes(a.name));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

  const mcpBin = resolveMcpServerBin();
  console.log(`[cross-agent-test] MCP server: ${mcpBin.command} ${mcpBin.args.join(' ')}`);

  const allAdapters = buildAdapters(mcpBin);
  const adapters = filterByName(allAdapters, args);
  if (adapters.length === 0) {
    console.error(`No matching adapters. Available: ${allAdapters.map((a) => a.name).join(', ')}`);
    process.exit(2);
  }
  console.log(`[cross-agent-test] Running against: ${adapters.map((a) => a.name).join(', ')}`);

  const startedAt = new Date();
  const t0 = Date.now();
  const results: ToolCallResult[] = [];

  for (const adapter of adapters) {
    console.log(`\n[${adapter.name}] handshake ...`);
    const handshake = await runHandshakeTest(adapter);
    results.push(handshakeResultToCall(handshake));
    console.log(`  handshakeOk=${handshake.handshakeOk} tools=${handshake.toolsDiscovered} sampleOk=${handshake.sampleToolOk} ${handshake.latencyMs}ms`);

    console.log(`[${adapter.name}] CRUD ...`);
    const crud = await runCrudTest(adapter);
    const crudCalls = crudResultToCall(crud);
    results.push(...crudCalls);
    const passed = crud.scenarios.filter((s) => s.success).length;
    console.log(`  ${passed}/${crud.scenarios.length} scenarios passed (${crud.totalLatencyMs}ms)`);

    console.log(`[${adapter.name}] after-chain ...`);
    const ac = await runAfterChainTest(adapter);
    results.push(afterChainResultToCall(ac));
    console.log(`  allOk=${ac.allOk} ${ac.latencyMs}ms`);

    console.log(`[${adapter.name}] watchdog ...`);
    const wd = await runWatchdogTest(adapter);
    const wdCalls = watchdogResultToCalls(wd);
    results.push(...wdCalls);
    const wdPassed = wd.cells.filter((c) => c.ok).length;
    console.log(`  ${wdPassed}/${wd.cells.length} cells ok (${wd.latencyMs}ms)`);

    adapter.cleanup();
  }

  const finishedAt = new Date();
  const passed = results.filter((r) => r.success).length;
  const summary: RunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - t0,
    totalCases: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  const jsonPath = writeJsonReport(summary, REPORTS_DIR);
  const mdPath = writeMarkdownReport(summary, REPORTS_DIR);

  console.log(`\n[cross-agent-test] Summary:`);
  console.log(`  Total:  ${summary.totalCases}`);
  console.log(`  Passed: ${summary.passed}`);
  console.log(`  Failed: ${summary.failed}`);
  console.log(`  JSON:   ${jsonPath}`);
  console.log(`  MD:     ${mdPath}`);

  process.exit(summary.failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[cross-agent-test] Fatal:', err);
  process.exit(2);
});