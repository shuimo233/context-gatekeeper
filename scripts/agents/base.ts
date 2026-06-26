/**
 * Base adapter interface for MCP-compatible agents.
 *
 * Each adapter encapsulates how a specific AI agent runtime
 * spawns a child process and communicates with the
 * Context Gatekeeper MCP server.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve as resolvePath } from 'node:path';

export type PermissionLevel = 'read' | 'write' | 'watchdog';

export interface AgentConfig {
  /** Name of the agent (used in reports) */
  name: string;
  /** Path to the agent CLI binary */
  cliPath?: string;
  /** Optional arguments to pass before the prompt */
  cliArgs?: string[];
  /** MCP config object written to a temp file before spawning */
  mcpConfig: Record<string, unknown>;
  /** Token configuration for Watchdog tests */
  tokens?: {
    read?: string;
    write?: string;
    watchdog?: string;
  };
  /** Per-agent DATA_DIR override */
  dataDir?: string;
  /** Timeout in ms for any single tool call (default 30000) */
  timeoutMs?: number;
}

export interface ToolCallResult {
  agent: string;
  tool: string;
  success: boolean;
  latencyMs: number;
  payload?: unknown;
  error?: string;
  raw?: string;
}

export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Abstract base class for agent adapters.
 *
 * Subclasses must implement `buildSpawnCommand` to construct the
 * child process invocation. The base class handles:
 *  - temp directory creation and cleanup
 *  - MCP config file generation
 *  - child process lifecycle (spawn, stdin/stdout JSON-RPC, kill)
 */
export abstract class BaseAgentAdapter {
  protected child: ChildProcess | null = null;
  protected dataDir: string;
  protected mcpConfigPath: string;
  protected config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.dataDir =
      config.dataDir ?? mkdtempSync(join(tmpdir(), `cg-${config.name}-`));
    this.mcpConfigPath = join(this.dataDir, 'mcp-config.json');
    writeFileSync(this.mcpConfigPath, JSON.stringify(config.mcpConfig, null, 2));
  }

  abstract get name(): string;
  abstract buildSpawnCommand(): {
    command: string;
    args: string[];
    env: Record<string, string | undefined>;
  };

  /** Spawn the agent child process. Returns the process handle. */
  spawnAgent(prompt: string): ChildProcess {
    const { command, args, env } = this.buildSpawnCommand();
    const mergedEnv = {
      ...process.env,
      ...env,
      DATA_DIR: this.dataDir,
      ...(this.config.tokens?.read ? { CG_READ_TOKEN: this.config.tokens.read } : {}),
      ...(this.config.tokens?.write ? { CG_WRITE_TOKEN: this.config.tokens.write } : {}),
      ...(this.config.tokens?.watchdog ? { CG_WATCHDOG_TOKEN: this.config.tokens.watchdog } : {}),
      CG_LOG_LEVEL: process.env.CG_LOG_LEVEL ?? 'warn',
      MCP_CONFIG_PATH: this.mcpConfigPath,
    };
    this.child = spawn(command, [...args, prompt], {
      env: mergedEnv as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.dataDir,
    });
    return this.child;
  }

  /** Read MCP server binary path from config. */
  protected getMcpServerCommand(): { command: string; args: string[] } {
    const cfg = this.config.mcpConfig;
    // Shape A: { mcpServers: { 'context-gatekeeper': { command, args } } }
    const a = (cfg as { mcpServers?: Record<string, { command: string; args: string[] }> }).mcpServers?.['context-gatekeeper'];
    if (a) return { command: a.command, args: a.args };
    // Shape B (Continue.dev): { experimental: { modelContextProtocolServers: [{ name, command, args }] } }
    const b = (cfg as { experimental?: { modelContextProtocolServers?: Array<{ name: string; command: string; args: string[] }> } })
      .experimental?.modelContextProtocolServers?.find((s) => s.name === 'context-gatekeeper');
    if (b) return { command: b.command, args: b.args };
    throw new Error(`mcpServers.context-gatekeeper not configured for agent ${this.name}`);
  }

  /** Build environment variables for a direct MCP server subprocess test. */
  buildMcpServerEnv(extra?: Record<string, string | undefined>): Record<string, string | undefined> {
    const cg = this.getMcpServerCommand();
    return {
      ...process.env,
      DATA_DIR: this.dataDir,
      ...(this.config.tokens?.read ? { CG_READ_TOKEN: this.config.tokens.read } : {}),
      ...(this.config.tokens?.write ? { CG_WRITE_TOKEN: this.config.tokens.write } : {}),
      ...(this.config.tokens?.watchdog ? { CG_WATCHDOG_TOKEN: this.config.tokens.watchdog } : {}),
      CG_LOG_LEVEL: process.env.CG_LOG_LEVEL ?? 'warn',
      MCP_CONFIG_PATH: this.mcpConfigPath,
      CG_SERVER_CMD: cg.command,
      CG_SERVER_ARGS: cg.args.join(' '),
      ...extra,
    };
  }

  /** Wait for the child to exit. Resolves with the exit code. */
  async waitForExit(timeoutMs = this.config.timeoutMs ?? 30000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    if (!this.child) throw new Error(`Agent ${this.name} not spawned`);
    const child = this.child;
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        reject(new Error(`Agent ${this.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Clean up temp directories. */
  cleanup(): void {
    try {
      if (this.child && !this.child.killed) {
        this.child.kill('SIGTERM');
      }
    } catch { /* ignore */ }
    if (existsSync(this.dataDir)) {
      try { rmSync(this.dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /** Get the absolute path to the temp data directory for this agent run. */
  getDataDir(): string {
    return this.dataDir;
  }
}

/** Resolve the MCP server binary path that will be used by all adapters. */
export function resolveMcpServerBin(): { command: string; args: string[] } {
  const pkgRoot = resolvePath(process.cwd());
  const candidates = [
    join(pkgRoot, 'dist', 'mcp', 'server.js'),
    join(pkgRoot, 'src', 'mcp', 'server.ts'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      if (path.endsWith('.ts')) {
        return { command: 'npx', args: ['tsx', path] };
      }
      return { command: process.execPath, args: [path] };
    }
  }
  throw new Error(`Cannot find MCP server binary. Looked in: ${candidates.join(', ')}. Run 'npm run build' first.`);
}