/**
 * Install (merge) the context-gatekeeper MCP entry into an agent's config
 * file. Reads the existing JSON (if any), merges in the new entry under
 * the right location, and atomically writes the result back.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { AgentName, detectAgent, Scope, AgentDetection, SUPPORTED_AGENTS } from './detect.ts';
import { buildConfigBlock, GATEKEEPER_KEY } from './config-gen.ts';

export interface InstallResult {
  agent: AgentName;
  configPath: string;
  scope: Scope;
  status: 'installed' | 'updated' | 'skipped' | 'error';
  message?: string;
}

function readJsonOrEmpty(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (trimmed.length === 0) return {};
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Expected JSON object at ${filePath}, got ${typeof parsed}`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

/**
 * For the four agents that use the `mcpServers` shape, merge our entry
 * under the `context-gatekeeper` key without touching other entries.
 */
function mergeMcpServersShape(
  existing: Record<string, unknown>,
  block: Record<string, unknown>,
): { merged: Record<string, unknown>; hadExisting: boolean } {
  const existingServers =
    (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  const newServers =
    (block.mcpServers as Record<string, unknown> | undefined) ?? {};
  const hadExisting = GATEKEEPER_KEY in existingServers;
  const mergedServers = { ...existingServers, ...newServers };
  return {
    merged: { ...existing, mcpServers: mergedServers },
    hadExisting,
  };
}

/**
 * Continue uses an array under `experimental.modelContextProtocolServers`,
 * identified by each entry's `name` field.
 */
function mergeContinueShape(
  existing: Record<string, unknown>,
  block: Record<string, unknown>,
): { merged: Record<string, unknown>; hadExisting: boolean } {
  const exp = (existing.experimental as Record<string, unknown> | undefined) ?? {};
  const arr =
    (exp.modelContextProtocolServers as Array<Record<string, unknown>> | undefined) ?? [];
  const newArr =
    ((block.experimental as Record<string, unknown> | undefined)?.modelContextProtocolServers as
      | Array<Record<string, unknown>>
      | undefined) ?? [];
  const newEntry = newArr[0];
  const hadExisting = arr.some((e) => e.name === newEntry?.name);
  const filtered = arr.filter((e) => e.name !== newEntry?.name);
  filtered.push(newEntry);
  return {
    merged: {
      ...existing,
      experimental: { ...exp, modelContextProtocolServers: filtered },
    },
    hadExisting,
  };
}

function mergeIntoExisting(
  agent: AgentName,
  existing: Record<string, unknown>,
): { merged: Record<string, unknown>; hadExisting: boolean } {
  const block = buildConfigBlock(agent) as Record<string, unknown>;
  if (agent === 'continue') return mergeContinueShape(existing, block);
  return mergeMcpServersShape(existing, block);
}

/**
 * Install context-gatekeeper into a single agent's config file.
 * Returns a status record the caller can present to the user.
 */
export function installAgent(
  agent: AgentName,
  options: { scope?: Scope; cwd?: string; force?: boolean } = {},
): InstallResult {
  // Claude Desktop has no project-level config; skip with a clear message
  // instead of silently falling back to the global path (which would
  // surprise the user when they thought they were writing to the project).
  if (options.scope === 'project' && agent === 'claude-desktop') {
    return {
      agent,
      configPath: '(project scope not supported)',
      scope: 'global',
      status: 'skipped',
      message: 'Claude Desktop is global-only; omit --local to install',
    };
  }
  const detection = detectAgent(agent, options);
  try {
    const existing = readJsonOrEmpty(detection.configPath);
    const { merged, hadExisting } = mergeIntoExisting(agent, existing);
    atomicWriteJson(detection.configPath, merged);
    return {
      agent,
      configPath: detection.configPath,
      scope: detection.scope,
      status: hadExisting ? 'updated' : 'installed',
    };
  } catch (err) {
    return {
      agent,
      configPath: detection.configPath,
      scope: detection.scope,
      status: 'error',
      message: (err as Error).message,
    };
  }
}

/**
 * Install across multiple agents. If `agents` is empty, installs into all
 * agents whose config file already exists on disk.
 */
export function installAgents(
  agents: AgentName[],
  options: { scope?: Scope; cwd?: string } = {},
): InstallResult[] {
  const targets: AgentDetection[] =
    agents.length > 0
      ? agents.map((a) => detectAgent(a, options))
      : SUPPORTED_AGENTS.map((a) => detectAgent(a, options)).filter((d) => d.exists);
  return targets.map((d) => installAgent(d.agent, options));
}