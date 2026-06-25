// Observability types and emitters for session and memory operations

export interface AuditEvent {
  id: string;
  timestamp: string;
  operation: string;
  targetKey: string;
  durationMs: number;
  success: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type AuditEventEmitter = (event: AuditEvent) => void;

export type { MemorySessionRecord } from '../schema/memory-session.js';

const emitters: Set<AuditEventEmitter> = new Set();

export function onAuditEvent(emitter: AuditEventEmitter): () => void {
  emitters.add(emitter);
  return () => emitters.delete(emitter);
}

export function emitAuditEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): void {
  const full: AuditEvent = {
    ...event,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString()
  };

  for (const emitter of emitters) {
    try {
      emitter(full);
    } catch {
      // silent
    }
  }
}

export function withAudit<T>(
  operation: string,
  targetKey: string,
  fn: () => T,
  metadata?: Record<string, unknown>
): T {
  const start = Date.now();

  try {
    const result = fn();
    emitAuditEvent({
      operation,
      targetKey,
      durationMs: Date.now() - start,
      success: true,
      metadata
    });
    return result;
  } catch (error) {
    emitAuditEvent({
      operation,
      targetKey,
      durationMs: Date.now() - start,
      success: false,
      reason: error instanceof Error ? error.message : String(error),
      metadata
    });
    throw error;
  }
}

export async function withAuditAsync<T>(
  operation: string,
  targetKey: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();

  try {
    const result = await fn();
    emitAuditEvent({
      operation,
      targetKey,
      durationMs: Date.now() - start,
      success: true,
      metadata
    });
    return result;
  } catch (error) {
    emitAuditEvent({
      operation,
      targetKey,
      durationMs: Date.now() - start,
      success: false,
      reason: error instanceof Error ? error.message : String(error),
      metadata
    });
    throw error;
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: Record<string, unknown>;
  checkedAt: string;
}

export interface HealthCheckInput {
  database?: boolean;
  llm?: boolean;
  embedding?: boolean;
  fts?: boolean;
}

export async function createHealthCheck(input: {
  getDbHealth: () => boolean;
  getFtsHealth: () => boolean;
  getLlmHealth?: () => Promise<boolean>;
}): Promise<(options?: HealthCheckInput) => Promise<HealthStatus>> {
  return async function healthCheck(options: HealthCheckInput = {}) {
    const checks = {
      database: true,
      llm: true,
      embedding: true,
      fts: true,
      ...options
    };

    const results: Record<string, boolean> = {};

    if (checks.database) {
      results.database = input.getDbHealth();
    }

    if (checks.fts) {
      results.fts = input.getFtsHealth();
    }

    if (checks.llm && input.getLlmHealth) {
      results.llm = await input.getLlmHealth();
    }

    const allHealthy = Object.values(results).every(Boolean);
    const anyHealthy = Object.values(results).some(Boolean);

    return {
      status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
      details: results,
      checkedAt: new Date().toISOString()
    };
  };
}

export interface MetricsCollector {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
  getSnapshot(): Record<string, unknown>;
}

export function createMetricsCollector(): MetricsCollector {
  const counters = new Map<string, number>();
  const histograms = new Map<string, number[]>();

  return {
    incrementCounter(name, labels) {
      const key = JSON.stringify({ name, labels });
      counters.set(key, (counters.get(key) ?? 0) + 1);
    },

    recordHistogram(name, value, labels) {
      const key = JSON.stringify({ name, labels });
      if (!histograms.has(key)) {
        histograms.set(key, []);
      }
      histograms.get(key)!.push(value);
    },

    getSnapshot() {
      const snapshot: Record<string, unknown> = {
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries(
          Array.from(histograms.entries()).map(([k, v]) => [
            k,
            {
              count: v.length,
              min: Math.min(...v),
              max: Math.max(...v),
              avg: v.reduce((a, b) => a + b, 0) / v.length
            }
          ])
        )
      };
      return snapshot;
    }
  };
}
