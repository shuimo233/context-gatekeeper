/**
 * SQLite database wrapper - compatible API with better-sqlite3
 * Uses sql.js (pure JavaScript, no native compilation required)
 */

import initSqlJs, { Database as SqlJsDatabase, SqlValue, Statement } from 'sql.js';
export type { SqlValue };

export function castParams(params: unknown[]): SqlValue[] {
  return params as SqlValue[];
}
import { DatabaseError } from './errors.js';
import { logger } from './logger.js';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

let db: SqlJsDatabase | null = null;
let dbPath: string = ':memory:';
let saveTimer: NodeJS.Timeout | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;

// 刷新间隔（毫秒），可通过环境变量配置
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const FLUSH_INTERVAL_ENV = 'CG_DB_FLUSH_INTERVAL_MS';

function getFlushInterval(): number {
  const envVal = process.env[FLUSH_INTERVAL_ENV];
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 1000) return parsed;
  }
  return DEFAULT_FLUSH_INTERVAL_MS;
}

function getDataDir(): string {
  const envDataDir = process.env.DATA_DIR;
  if (envDataDir) return envDataDir;
  
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || '', 'context-gatekeeper');
  } else if (process.platform === 'darwin') {
    return join(process.env.HOME || '', 'Library', 'Application Support', 'context-gatekeeper');
  } else {
    return join(process.env.HOME || '', '.context-gatekeeper');
  }
}

function _getDbPath(): string {
  return join(getDataDir(), 'memory.db');
}

export async function initDatabase(path?: string): Promise<SqlJsDatabase> {
  // If already initialized, return immediately
  if (db) return db;
  if (initPromise) return initPromise;

  const targetPath = path || _getDbPath();
  
  // For synchronous usage (testing), check if we can return immediately
  if (db) {
    return db;
  }

  initPromise = (async () => {
    const SQL = await initSqlJs();
    dbPath = targetPath;

    if (dbPath !== ':memory:') {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (existsSync(dbPath)) {
        try {
          const buffer = readFileSync(dbPath);
          db = new SQL.Database(buffer);
        } catch {
          db = new SQL.Database();
        }
      } else {
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA synchronous=NORMAL');
    db.run('PRAGMA busy_timeout=5000');
    db.run('PRAGMA cache_size=-64000');

    if (dbPath !== ':memory:') {
      scheduleSave();
    }

    return db;
  })();

  return initPromise;
}

export function initDatabaseSync(_path?: string): SqlJsDatabase {
  if (db) return db;
  
  // This will throw - caller must use await initDatabase()
  throw new DatabaseError('Database not initialized. Use await initDatabase() first.');
}

function scheduleSave(): void {
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(saveDatabase, getFlushInterval());
}

function saveDatabase(): void {
  if (!db || dbPath === ':memory:') return;

  try {
    if (!existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
  } catch (error) {
    logger.error('Failed to save database', { error });
  }
}

/** 手动刷新数据库到磁盘（适用于优雅关闭） */
export function flushDatabase(): void {
  saveDatabase();
}

/** 获取当前数据库路径 */
export function getDbPath(): string {
  return dbPath;
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new DatabaseError('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function closeDatabase(): void {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }

  if (db) {
    flushDatabase();
    db.close();
    db = null;
  }
  initPromise = null;
}

function prepare(sql: string): Statement {
  return getDatabase().prepare(sql);
}

export function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): T[] {
  try {
    const stmt = prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params as SqlValue[]);
    }
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  } catch (error) {
    throw new DatabaseError(`Query failed: ${sql}`, error);
  }
}

export function run(
  sql: string,
  params?: unknown[]
): { changes: number; lastInsertRowid: number } {
  try {
    if (params && params.length > 0) {
      getDatabase().run(sql, params as SqlValue[]);
    } else {
      getDatabase().run(sql);
    }
    const changes = getDatabase().getRowsModified();
    const result = getDatabase().exec('SELECT last_insert_rowid()');
    const lastInsertRowid = result.length > 0 ? Number(result[0].values[0][0]) : 0;
    return { changes, lastInsertRowid };
  } catch (error) {
    throw new DatabaseError(`Execution failed: ${sql}`, error);
  }
}

export function transaction<T>(fn: () => T): T {
  try {
    getDatabase().run('BEGIN TRANSACTION');
    try {
      const result = fn();
      getDatabase().run('COMMIT');
      return result;
    } catch (error) {
      getDatabase().run('ROLLBACK');
      throw error;
    }
  } catch (error) {
    throw new DatabaseError('Transaction failed', error);
  }
}

export function resetDatabase(): void {
  closeDatabase();
}

export default { query, run, transaction };
