/**
 * Shared MCP JSON-RPC client used by all test suites.
 *
 * Spawns the MCP server as a child process with stdio transport, performs
 * the `initialize` handshake, and provides a `callTool` helper.
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

export interface McpClientOptions {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  parsed?: unknown;
  /**
   * Convenience flag: true when either the MCP layer marked the call as an
   * error OR the tool payload contains `{ error: ... }` (which is how
   * Context Gatekeeper surfaces permission denials and tool-level errors).
   */
  errored?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

const PROTOCOL_VERSION = '2024-11-05';

export class McpTestClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private notificationHandlers = new Set<(n: unknown) => void>();
  private stderrBuf = '';

  constructor(private readonly options: McpClientOptions) {}

  async start(): Promise<void> {
    this.child = spawn(this.options.command, this.options.args, {
      env: { ...process.env, ...(this.options.env ?? {}) } as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd,
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => { this.stderrBuf += chunk; });

    this.child.on('exit', (code) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(`MCP server exited (code=${code}) before responding`));
      }
      this.pending.clear();
    });

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP server did not become ready')), 5000);
      const onData = (chunk: string) => {
        if (chunk.includes('"jsonrpc"') || chunk.includes('Server listening')) {
          clearTimeout(timer);
          this.child?.stdout?.off('data', onData);
          resolve();
        }
      };
      this.child?.stdout?.on('data', onData);
    });

    const initPromise = this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'cross-agent-test', version: '0.1.0' },
    });
    await Promise.all([initPromise, ready]);
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request('tools/list', {})) as { tools: McpToolDescriptor[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    const textItem = result.content?.find((c) => c.type === 'text');
    let parsed: unknown;
    if (textItem) {
      try { parsed = JSON.parse(textItem.text); } catch { parsed = textItem.text; }
    }
    const parsedError = (() => {
      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        return Boolean((parsed as { error?: unknown }).error);
      }
      return false;
    })();
    return { ...result, parsed, errored: result.isError || parsedError };
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try { this.child.stdin.end(); } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { this.child?.kill('SIGKILL'); } catch { /* ignore */ }
        resolve();
      }, 2000);
      this.child?.on('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.child = null;
  }

  getStderr(): string { return this.stderrBuf; }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const handler = this.pending.get(msg.id);
          if (handler) {
            this.pending.delete(msg.id);
            if (msg.error) handler.reject(new Error(JSON.stringify(msg.error)));
            else handler.resolve(msg.result);
          }
        } else {
          for (const h of this.notificationHandlers) h(msg);
        }
      } catch {
        // ignore non-JSON noise
      }
    }
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.child) throw new Error('MCP client not started');
    const id = this.nextId++;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = JSON.stringify(msg) + '\n';
      this.child!.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out after 30s`));
        }
      }, 30000);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child) return;
    const msg = { jsonrpc: '2.0', method, params };
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }
}