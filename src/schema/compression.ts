import { v4 as uuidv4 } from 'uuid';
import { query, run } from '../utils/db.js';
import { Compression } from '../models/types.js';
import { DatabaseError } from '../utils/errors.js';

interface CompressionRow {
  id: string;
  memory_id: string;
  operation: string;
  delta: string;
  summary: string;
  created_at: string;
}

function rowToCompression(row: CompressionRow): Compression {
  return {
    id: row.id,
    memoryId: row.memory_id,
    operation: row.operation as Compression['operation'],
    delta: JSON.parse(row.delta),
    summary: row.summary,
    createdAt: new Date(row.created_at)
  };
}

export function createCompression(
  memoryId: string,
  operation: Compression['operation'],
  delta: Record<string, unknown>,
  summary: string
): Compression {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  try {
    run(`
      INSERT INTO compressions (id, memory_id, operation, delta, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, memoryId, operation, JSON.stringify(delta), summary, now]);
    
    return getCompression(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create compression record', error);
  }
}

export function getCompression(id: string): Compression | null {
  try {
    const results = query<CompressionRow>('SELECT * FROM compressions WHERE id = ?', [id]);
    return results.length > 0 ? rowToCompression(results[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get compression', error);
  }
}

export function getCompressionHistory(memoryId: string): Compression[] {
  try {
    const rows = query<CompressionRow>(
      `SELECT * FROM compressions WHERE memory_id = ? ORDER BY created_at DESC`,
      [memoryId]
    );
    return rows.map(rowToCompression);
  } catch (error) {
    throw new DatabaseError('Failed to get compression history', error);
  }
}

export function listCompressions(): Compression[] {
  try {
    const rows = query<CompressionRow>('SELECT * FROM compressions ORDER BY created_at DESC');
    return rows.map(rowToCompression);
  } catch (error) {
    throw new DatabaseError('Failed to list compressions', error);
  }
}

export function cleanupOldCompressions(olderThanDays: number = 30): number {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    
    const result = run(`DELETE FROM compressions WHERE created_at < ?`, [cutoff.toISOString()]);
    return result.changes;
  } catch (error) {
    throw new DatabaseError('Failed to cleanup old compressions', error);
  }
}
