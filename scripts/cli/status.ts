/**
 * Print a status table showing which supported agents have a config
 * file on disk and whether context-gatekeeper is already wired into it.
 */

import { detectAll, AgentDetection, AgentName, SUPPORTED_AGENTS } from './detect.ts';

const PAD = (s: string | number, n: number): string => String(s).padEnd(n);

export function renderStatusTable(detections: AgentDetection[]): string {
  const headers = ['Agent', 'Scope', 'Config Path', 'Status'];
  const rows: string[][] = detections.map((d) => [
    d.agent,
    d.scope,
    d.configPath,
    describe(d),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
  );

  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const out: string[] = [];
  out.push(headers.map((h, i) => PAD(h, widths[i])).join('  '));
  out.push(sep);
  for (const r of rows) {
    out.push(r.map((cell, i) => PAD(cell, widths[i])).join('  '));
  }
  return out.join('\n');
}

function describe(d: AgentDetection): string {
  if (!d.exists) return 'not detected';
  return d.installed ? 'installed' : 'available';
}

export function printStatus(detections: AgentDetection[] = detectAll()): void {
  // Sort for predictable output: known agent order.
  const order = new Map<AgentName, number>(SUPPORTED_AGENTS.map((a, i) => [a, i]));
  const sorted = [...detections].sort(
    (a, b) => (order.get(a.agent) ?? 99) - (order.get(b.agent) ?? 99),
  );
  console.log(renderStatusTable(sorted));
  const installed = sorted.filter((d) => d.installed).length;
  const available = sorted.filter((d) => d.exists && !d.installed).length;
  console.log(`\n${installed} installed, ${available} available, ${sorted.length - installed - available} not detected`);
}