/**
 * JSON and Markdown report writers.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolCallResult } from '../agents/base.ts';

export interface RunSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCases: number;
  passed: number;
  failed: number;
  results: ToolCallResult[];
}

export function writeJsonReport(summary: RunSummary, outDir: string): string {
  const path = join(outDir, `report-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(summary, null, 2), 'utf8');
  return path;
}

export function writeMarkdownReport(summary: RunSummary, outDir: string): string {
  const lines: string[] = [];
  lines.push(`# Cross-Agent Compatibility Report`);
  lines.push('');
  lines.push(`- Started:  ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- Duration: ${summary.durationMs}ms`);
  lines.push(`- Total:    ${summary.totalCases}`);
  lines.push(`- Passed:   ${summary.passed}`);
  lines.push(`- Failed:   ${summary.failed}`);
  lines.push('');

  const byAgent = new Map<string, ToolCallResult[]>();
  for (const r of summary.results) {
    const arr = byAgent.get(r.agent) ?? [];
    arr.push(r);
    byAgent.set(r.agent, arr);
  }

  for (const [agent, results] of byAgent) {
    const passed = results.filter((r) => r.success).length;
    lines.push(`## ${agent}`);
    lines.push('');
    lines.push(`Status: ${passed}/${results.length} passed`);
    lines.push('');
    lines.push(`| Tool | Success | Latency (ms) | Error |`);
    lines.push(`|------|---------|--------------|-------|`);
    for (const r of results) {
      lines.push(`| ${r.tool} | ${r.success ? 'OK' : 'FAIL'} | ${r.latencyMs} | ${r.error ?? ''} |`);
    }
    lines.push('');
  }

  const path = join(outDir, `report-${Date.now()}.md`);
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}