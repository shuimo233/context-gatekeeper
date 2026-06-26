/**
 * Remove the context-gatekeeper entry from an agent's config file.
 * If the removal leaves the file with no remaining MCP servers, the
 * file itself is deleted.
 */

import { unlinkSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';

import { AgentName, detectAgent, Scope, AgentDetection, SUPPORTED_AGENTS } from './detect.ts';
import { GATEKEEPER_KEY } from './config-gen.ts';

export interface UninstallResult {
  agent: AgentName;
  configPath: string;
  scope: Scope;
  status: 'removed' | 'skipped' | 'error';
  message?: string;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (raw.length === 0) return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: Record<string, unknown>): void {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, filePath);
}

function hasAnyMcpServers(value: Record<string, unknown>): boolean {
  const servers = value.mcpServers as Record<string, unknown> | undefined;
  if (servers && Object.keys(servers).length > 0) return true;
  const exp = value.experimental as { modelContextProtocolServers?: unknown[] } | undefined;
  if (exp?.modelContextProtocolServers && exp.modelContextProtocolServers.length > 0) return true;
  return false;
}

/**
 * Strip the context-gatekeeper entry from a parsed config object.
 * Returns the (possibly modified) object and a flag indicating whether
 * any change was made.
 */
function stripEntry(agent: AgentName, value: Record<string, unknown>): {
  value: Record<string, unknown>;
  changed: boolean;
} {
  if (agent === 'continue') {
    const exp = (value.experimental as Record<string, unknown> | undefined) ?? {};
    const arr = (exp.modelContextProtocolServers as Array<Record<string, unknown>> | undefined) ?? [];
    const filtered = arr.filter((e) => e.name !== GATEKEEPER_KEY);
    if (filtered.length === arr.length) return { value, changed: false };
    const nextExp = { ...exp, modelContextProtocolServers: filtered };
    if (filtered.length === 0) {
      const { experimental: _drop, ...rest } = value;
      return { value: rest, changed: true };
    }
    return { value: { ...value, experimental: nextExp }, changed: true };
  }

  const servers = (value.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (!(GATEKEEPER_KEY in servers)) return { value, changed: false };
  const nextServers = { ...servers };
  delete nextServers[GATEKEEPER_KEY];
  if (Object.keys(nextServers).length === 0) {
    const { mcpServers: _drop, ...rest } = value;
    return { value: rest, changed: true };
  }
  return { value: { ...value, mcpServers: nextServers }, changed: true };
}

export function uninstallAgent(
  agent: AgentName,
  options: { scope?: Scope; cwd?: string } = {},
): UninstallResult {
  // Claude Desktop has no project-level config; skip rather than touching
  // the global path the user did not intend to modify.
  if (options.scope === 'project' && agent === 'claude-desktop') {
    return {
      agent,
      configPath: '(project scope not supported)',
      scope: 'global',
      status: 'skipped',
      message: 'Claude Desktop is global-only; omit --local to uninstall',
    };
  }
  const detection = detectAgent(agent, options);
  if (!detection.exists) {
    return {
      agent,
      configPath: detection.configPath,
      scope: detection.scope,
      status: 'skipped',
      message: 'config file does not exist',
    };
  }
  const value = readJsonObject(detection.configPath);
  if (value === null) {
    return {
      agent,
      configPath: detection.configPath,
      scope: detection.scope,
      status: 'error',
      message: 'config file is not a JSON object',
    };
  }
  try {
    const { value: next, changed } = stripEntry(agent, value);
    if (!changed) {
      return {
        agent,
        configPath: detection.configPath,
        scope: detection.scope,
        status: 'skipped',
        message: 'context-gatekeeper entry not present',
      };
    }
    if (!hasAnyMcpServers(next) && Object.keys(next).length === 0) {
      unlinkSync(detection.configPath);
    } else {
      writeJson(detection.configPath, next);
    }
    return {
      agent,
      configPath: detection.configPath,
      scope: detection.scope,
      status: 'removed',
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

export function uninstallAgents(
  agents: AgentName[],
  options: { scope?: Scope; cwd?: string } = {},
): UninstallResult[] {
  const targets: AgentDetection[] =
    agents.length > 0
      ? agents.map((a) => detectAgent(a, options))
      : SUPPORTED_AGENTS.map((a) => detectAgent(a, options));
  return targets.map((d) => uninstallAgent(d.agent, options));
}