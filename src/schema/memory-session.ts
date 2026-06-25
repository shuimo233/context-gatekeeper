import { getDatabase } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';
import { query, run } from '../utils/db.js';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

export interface MemorySessionRecord {
  id: string;
  userId: string;
  agentId: string;
  projectId: string;
  scope: string;
  key: string;
  value: string | null;
  meta: Record<string, unknown>;
  version: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: Date | null;
  deleted: boolean;
}

export interface MemorySessionInput {
  userId: string;
  agentId: string;
  projectId: string;
  scope: 'session' | 'short' | 'long' | 'archival';
  key: string;
  value?: string;
  meta?: Record<string, unknown>;
  updatedBy?: string;
  expiresAt?: Date | string | null;
}

export interface SessionCleanupStats {
  sessionRemoved: number;
  shortRemoved: number;
  longRemoved: number;
  archivalRemoved: number;
}

export function createMemorySession(input: MemorySessionInput): MemorySessionRecord {
  const id = generateId(input);
  const now = new Date().toISOString();

  try {
    const expiresAt = input.expiresAt instanceof Date ? input.expiresAt.toISOString() : (input.expiresAt ?? null);

    run(
      `
      INSERT OR REPLACE INTO memory_sessions
        (id, user_id, agent_id, project_id, scope, key, value, meta, version, updated_by, created_at, updated_at, expires_at, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 0)
      `,
      [
        id,
        input.userId,
        input.agentId,
        input.projectId,
        input.scope,
        input.key,
        input.value ?? null,
        JSON.stringify(input.meta ?? {}),
        input.updatedBy ?? null,
        now,
        now,
        expiresAt
      ]
    );

    return getMemorySession(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create memory session', error);
  }
}

export function getMemorySession(id: string): MemorySessionRecord | null {
  try {
    const rows = query<MemorySessionRecordRow>(`SELECT * FROM memory_sessions WHERE id = ? AND deleted = 0`, [id]);
    return rows.length > 0 ? mapMemorySessionRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get memory session', error);
  }
}

export function getMemorySessionByIsolation(input: {
  userId: string;
  agentId: string;
  projectId: string;
  scope: MemorySessionInput['scope'];
  key: string;
}): MemorySessionRecord | null {
  try {
    const rows = query<MemorySessionRecordRow>(
      `SELECT * FROM memory_sessions WHERE user_id = ? AND agent_id = ? AND project_id = ? AND scope = ? AND key = ? AND deleted = 0`,
      [input.userId, input.agentId, input.projectId, input.scope, input.key]
    );

    return rows.length > 0 ? mapMemorySessionRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get memory session by isolation', error);
  }
}

export function listMemorySessions(input: {
  userId?: string;
  agentId?: string;
  projectId?: string;
  scope?: MemorySessionInput['scope'];
  key?: string;
  includeDeleted?: boolean;
  limit?: number;
} = {}): MemorySessionRecord[] {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (input.userId) {
      conditions.push('user_id = ?');
      params.push(input.userId);
    }

    if (input.agentId) {
      conditions.push('agent_id = ?');
      params.push(input.agentId);
    }

    if (input.projectId) {
      conditions.push('project_id = ?');
      params.push(input.projectId);
    }

    if (input.scope) {
      conditions.push('scope = ?');
      params.push(input.scope);
    }

    if (input.key) {
      conditions.push('key = ?');
      params.push(input.key);
    }

    if (!input.includeDeleted) {
      conditions.push('deleted = 0');
    }

    const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
    const sql = `SELECT * FROM memory_sessions${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = query<MemorySessionRecordRow>(sql, params);
    return rows.map(mapMemorySessionRow);
  } catch (error) {
    throw new DatabaseError('Failed to list memory sessions', error);
  }
}

export function updateMemorySession(id: string, input: {
  value?: string;
  meta?: Record<string, unknown>;
  updatedBy?: string;
  expiresAt?: Date | string | null;
  deleted?: boolean;
}): MemorySessionRecord {
  const existing = getMemorySession(id);
  if (!existing) {
    throw new DatabaseError('Memory session not found', new Error(id));
  }

  const updates: string[] = ['version = version + 1', 'updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  if (input.value !== undefined) {
    updates.push('value = ?');
    values.push(input.value ?? null);
  }

  if (input.meta !== undefined) {
    updates.push('meta = ?');
    values.push(JSON.stringify(input.meta));
  }

  if (input.updatedBy !== undefined) {
    updates.push('updated_by = ?');
    values.push(input.updatedBy);
  }

  if (input.expiresAt !== undefined) {
    updates.push('expires_at = ?');
    const expiresAt = input.expiresAt instanceof Date ? input.expiresAt.toISOString() : (input.expiresAt ?? null);
    values.push(expiresAt);
  }

  if (input.deleted !== undefined) {
    updates.push('deleted = ?');
    values.push(input.deleted ? 1 : 0);
  }

  values.push(id);
  run(`UPDATE memory_sessions SET ${updates.join(', ')} WHERE id = ?`, values);

  return getMemorySession(id)!;
}

export function deleteMemorySession(id: string): void {
  try {
    const result = run(`UPDATE memory_sessions SET deleted = 1, updated_at = ?, version = version + 1 WHERE id = ? AND deleted = 0`, [
      new Date().toISOString(),
      id
    ]);

    if (result.changes === 0) {
      throw new DatabaseError('Memory session not found', new Error(id));
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError('Failed to delete memory session', error);
  }
}

export function cleanupExpiredMemorySessions(): SessionCleanupStats {
  const now = new Date().toISOString();
  const scopeStats: Record<string, number> = { session: 0, short: 0, long: 0, archival: 0 };

  try {
    const expiredRows = query<{ scope: string }>(
      `SELECT scope FROM memory_sessions WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime(?) AND deleted = 0`,
      [now]
    );

    for (const row of expiredRows) {
      scopeStats[row.scope] = (scopeStats[row.scope] || 0) + 1;
    }

    run(
      `
      UPDATE memory_sessions
      SET deleted = 1, updated_at = ?, version = version + 1
      WHERE expires_at IS NOT NULL
        AND datetime(expires_at) < datetime(?)
        AND deleted = 0
      `,
      [now, now]
    );

    return {
      sessionRemoved: scopeStats.session ?? 0,
      shortRemoved: scopeStats.short ?? 0,
      longRemoved: scopeStats.long ?? 0,
      archivalRemoved: scopeStats.archival ?? 0
    };
  } catch (error) {
    throw new DatabaseError('Failed to cleanup expired memory sessions', error);
  }
}

export function initMemorySessions(): void {
  const db = getDatabase();

  try {
    // First, migrate any existing table to add new columns
    const sessionsColumnsToAdd = [
      { name: 'user_id', def: "TEXT DEFAULT 'default'" },
      { name: 'agent_id', def: "TEXT DEFAULT 'default'" },
      { name: 'project_id', def: "TEXT DEFAULT 'default'" },
    ];

    // Check if table exists and has columns
    const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_sessions'`);
    if (tableCheck.length > 0 && tableCheck[0].values.length > 0) {
      // Table exists - get existing columns
      const result = db.exec(`PRAGMA table_info(memory_sessions)`);
      const existingColumns = result[0]?.values?.map((row: unknown[]) => (row as unknown[])[1] as string) || [];

      // Add missing columns
      for (const col of sessionsColumnsToAdd) {
        if (!existingColumns.includes(col.name)) {
          try {
            db.run(`ALTER TABLE memory_sessions ADD COLUMN ${col.name} ${col.def}`);
          } catch (error) {
            // Ignore "duplicate column name" errors (sql.js may return "duplicate column name: colname")
            if (!(error instanceof Error && /duplicate column/i.test(error.message))) {
              logger.warn(`Failed to add column memory_sessions.${col.name}`, { column: col.name, error: error instanceof Error ? error.message : String(error) });
            }
          }
        }
      }
    }
    // If table doesn't exist, CREATE TABLE will create it with all columns

    db.run(`
      CREATE TABLE IF NOT EXISTS memory_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        agent_id TEXT NOT NULL DEFAULT 'default',
        project_id TEXT NOT NULL DEFAULT 'default',
        scope TEXT NOT NULL CHECK (scope IN ('session', 'short', 'long', 'archival')),
        key TEXT NOT NULL,
        value TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_sessions_isolation ON memory_sessions(user_id, agent_id, project_id, scope, key)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_sessions_user_agent_project ON memory_sessions(user_id, agent_id, project_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_sessions_scope ON memory_sessions(scope)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_sessions_updated_at ON memory_sessions(updated_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_sessions_deleted ON memory_sessions(deleted)`);
  } catch (error) {
    throw new DatabaseError('Failed to initialize memory session schema', error);
  }
}

function generateId(input: MemorySessionInput): string {
  const normalizedKey = input.key.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const unique = `${input.userId}:${input.agentId}:${input.projectId}:${input.scope}:${normalizedKey}`;
  return `ms-${createHash('sha1').update(unique).digest('hex')}`;
}

interface MemorySessionRecordRow {
  id: string;
  user_id: string;
  agent_id: string;
  project_id: string;
  scope: string;
  key: string;
  value: string | null;
  meta: string;
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  deleted: number;
}

function mapMemorySessionRow(row: MemorySessionRecordRow): MemorySessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    projectId: row.project_id,
    scope: row.scope as MemorySessionRecord['scope'],
    key: row.key,
    value: row.value,
    meta: safeParseJson(row.meta),
    version: row.version,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    deleted: row.deleted === 1
  };
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed payloads
  }

  return {};
}
