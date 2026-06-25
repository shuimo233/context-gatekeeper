import { getDatabase } from '../utils/db.js';
import { query } from '../utils/db.js';

export interface FullTextResult {
  memoryId: string;
  content: string;
  rank: number;
  bm25Score: number;
}

export function initFullTextSearch(): void {
  const db = getDatabase();

  try {
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        memory_id UNINDEXED,
        content,
        content='memories',
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(memory_id, content) VALUES (new.id, new.content);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, memory_id, content) VALUES('delete', old.id, old.content);
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, memory_id, content) VALUES('delete', old.id, old.content);
        INSERT INTO memories_fts(memory_id, content) VALUES (new.id, new.content);
      END
    `);
  } catch {
    // FTS5 not supported in sql.js - graceful degradation, no-op
  }
}

export function searchFullText(
  queryText: string,
  limit: number = 10
): FullTextResult[] {
  if (!queryText || queryText.trim().length === 0) {
    return [];
  }

  try {
    const results = query<{ memory_id: string; content: string; rank: string; bm25: string }>(
      `
      SELECT f.memory_id, m.content, bm25(memories_fts) as rank, bm25(memories_fts) as bm25
      FROM memories_fts f
      JOIN memories m ON f.memory_id = m.id
      WHERE memories_fts MATCH ? AND m.deleted = 0
      ORDER BY rank
      LIMIT ?
      `,
      [queryText, limit]
    );

    return results.map(row => ({
      memoryId: row.memory_id,
      content: row.content,
      rank: parseFloat(row.rank),
      bm25Score: parseFloat(row.bm25)
    }));
  } catch {
    // FTS5 not supported or table not initialized - graceful degradation
    return [];
  }
}

export function rebuildFullTextIndex(): number {
  const db = getDatabase();

  try {
    db.run(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);

    const count = query<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM memories WHERE deleted = 0`);
    return count[0]?.cnt ?? 0;
  } catch {
    // FTS5 not supported - graceful degradation
    return 0;
  }
}
