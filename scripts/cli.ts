#!/usr/bin/env node
/**
 * context-gatekeeper install helper CLI.
 *
 * Subcommands:
 *   install   [agent ...]   - merge the MCP entry into one or more agents' configs
 *   uninstall [agent ...]   - remove the MCP entry from one or more agents' configs
 *   status                  - print a table of detected agents and install state
 *   help                    - print usage
 *
 * Examples:
 *   npx context-gatekeeper install --all
 *   npx context-gatekeeper install cursor claude-code
 *   npx context-gatekeeper uninstall --all
 *   npx context-gatekeeper status
 *
 * Exit codes:
 *   0 - success
 *   1 - one or more operations failed (or were skipped, for uninstall)
 *   2 - invalid usage
 */

import { installAgents, InstallResult } from './cli/install.ts';
import { uninstallAgents, UninstallResult } from './cli/uninstall.ts';
import { printStatus } from './cli/status.ts';
import { detectAll, isValidAgent, AgentName, SUPPORTED_AGENTS } from './cli/detect.ts';

const HELP = `context-gatekeeper installer

Usage:
  context-gatekeeper install [agent ...] [--all] [--local]
  context-gatekeeper uninstall [agent ...] [--all] [--local]
  context-gatekeeper status [--local]
  context-gatekeeper help

Agents:
  ${SUPPORTED_AGENTS.join(', ')}

Options:
  --all      target every supported agent (default for uninstall when none given)
  --local    write to project-local config (./.cursor/mcp.json, etc.) instead of global
             (Claude Desktop is always global-only)

Examples:
  context-gatekeeper install --all
  context-gatekeeper install cursor claude-code
  context-gatekeeper uninstall cursor
  context-gatekeeper status
`;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Set<string>;
  flagValues: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Set<string>();
  const flagValues = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        const name = a.slice(2, eq);
        const value = a.slice(eq + 1);
        flags.add(name);
        flagValues.set(name, value);
      } else {
        const name = a.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith('--') && TAKES_VALUE.has(name)) {
          flags.add(name);
          flagValues.set(name, next);
          i++;
        } else {
          flags.add(name);
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags, flagValues };
}

const TAKES_VALUE = new Set(['cwd']);

function resolveAgents(positional: string[], allFlag: boolean): AgentName[] {
  if (allFlag) return [...SUPPORTED_AGENTS];
  if (positional.length === 0) return [];
  const invalid = positional.filter((a) => !isValidAgent(a));
  if (invalid.length > 0) {
    console.error(`Unknown agent(s): ${invalid.join(', ')}`);
    console.error(`Available: ${SUPPORTED_AGENTS.join(', ')}`);
    process.exit(2);
  }
  return positional as AgentName[];
}

function reportInstall(results: InstallResult[]): number {
  let failed = 0;
  for (const r of results) {
    const tag = r.status === 'error' ? 'ERROR' : r.status.toUpperCase().padEnd(9);
    console.log(`[${tag}] ${r.agent.padEnd(15)} ${r.configPath}`);
    if (r.message) console.log(`         ${r.message}`);
    if (r.status === 'error') failed++;
  }
  return failed === 0 ? 0 : 1;
}

function reportUninstall(results: UninstallResult[]): number {
  let failed = 0;
  for (const r of results) {
    const tag = r.status === 'error' ? 'ERROR' : r.status.toUpperCase().padEnd(9);
    console.log(`[${tag}] ${r.agent.padEnd(15)} ${r.configPath}`);
    if (r.message) console.log(`         ${r.message}`);
    if (r.status === 'error') failed++;
  }
  return failed === 0 ? 0 : 1;
}

function main(argv: string[]): number {
  const { command, positional, flags, flagValues } = parseArgs(argv);
  const scope = flags.has('local') ? 'project' : 'global';
  const allFlag = flags.has('all');
  const cwd = flagValues.get('cwd');
  const opts = cwd ? { scope, cwd } : { scope };

  switch (command) {
    case 'help':
    case '--help':
    case '-h': {
      console.log(HELP);
      return 0;
    }
    case 'install': {
      const agents = resolveAgents(positional, allFlag);
      if (agents.length === 0) {
        console.error('No agents specified. Use --all or pass agent names.');
        console.error(`Available: ${SUPPORTED_AGENTS.join(', ')}`);
        return 2;
      }
      const results = installAgents(agents, opts);
      return reportInstall(results);
    }
    case 'uninstall': {
      const agents = resolveAgents(positional, allFlag);
      if (agents.length === 0) {
        console.error('No agents specified. Use --all or pass agent names.');
        console.error(`Available: ${SUPPORTED_AGENTS.join(', ')}`);
        return 2;
      }
      const results = uninstallAgents(agents, opts);
      return reportUninstall(results);
    }
    case 'status': {
      printStatus(detectAll(opts));
      return 0;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      return 2;
    }
  }
}

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);