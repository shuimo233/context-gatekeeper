import { vi } from 'vitest';
import initSqlJs from 'sql.js';

let db: Awaited<ReturnType<typeof initSqlJs>>['Database'] | null = null;

export async function getTestDatabase() {
  if (!db) {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA synchronous=NORMAL');
    db.run('PRAGMA busy_timeout=5000');
    db.run('PRAGMA cache_size=-64000');
  }
  return db;
}

export function resetTestDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

export function createTestDb() {
  return getTestDatabase();
}

export function clearTestDb(currentDb: Awaited<ReturnType<typeof initSqlJs>>['Database']) {
  const tables = currentDb
    .exec("SELECT name FROM sqlite_master WHERE type='table'")
    .flatMap((result) => result.values as unknown[][])
    .map((row) => row[0] as string)
    .filter((name) => name !== 'sqlite_sequence');

  for (const table of tables) {
    currentDb.run(`DELETE FROM ${table}`);
  }
}
