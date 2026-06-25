import { getDatabase, castParams } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';
import { query } from '../utils/db.js';

export interface VectorIndexRecord {
  id: string;
  name: string;
  type: string;
  dimension: number;
  metric: string;
  params: Record<string, unknown>;
  status: string;
  lastRebuildAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function registerVectorIndex(record: {
  id: string;
  name: string;
  dimension: number;
  type?: string;
  metric?: string;
  params?: Record<string, unknown>;
}): VectorIndexRecord {
  const db = getDatabase();

  try {
    const existing = query<{ id: string }>(
      `SELECT id FROM vector_index_metadata WHERE name = ?`,
      [record.name]
    );

    if (existing.length > 0) {
      const normalized = normalizeRecord(record);
      db.run(
        `
        UPDATE vector_index_metadata
        SET type = ?, dimension = ?, metric = ?, params = ?, status = 'building', updated_at = datetime('now')
        WHERE id = ?
        `,
        [normalized.type, normalized.dimension, normalized.metric, JSON.stringify(normalized.params), existing[0].id]
      );

      return getVectorIndex(existing[0].id)!;
    }

    const normalized = normalizeRecord({
      ...record,
      status: 'building',
      lastRebuildAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    db.run(
      `
      INSERT INTO vector_index_metadata (id, name, type, dimension, metric, params, status, last_rebuild_at, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        normalized.id,
        normalized.name,
        normalized.type,
        normalized.dimension,
        normalized.metric,
        JSON.stringify(normalized.params),
        normalized.status,
        normalized.lastRebuildAt,
        normalized.errorMessage,
        normalized.createdAt,
        normalized.updatedAt
      ]
    );

    return getVectorIndex(normalized.id)!;
  } catch (error) {
    throw new DatabaseError('Failed to register vector index', error);
  }
}

export function getVectorIndex(id: string): VectorIndexRecord | null {
  try {
    const rows = query<{
      id: string;
      name: string;
      type: string;
      dimension: number;
      metric: string;
      params: string;
      status: string;
      last_rebuild_at: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(`SELECT * FROM vector_index_metadata WHERE id = ?`, [id]);

    if (rows.length === 0) return null;
    return mapRow(rows[0]);
  } catch {
    return null;
  }
}

export function getVectorIndexByName(name: string): VectorIndexRecord | null {
  try {
    const rows = query<{
      id: string;
      name: string;
      type: string;
      dimension: number;
      metric: string;
      params: string;
      status: string;
      last_rebuild_at: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(`SELECT * FROM vector_index_metadata WHERE name = ?`, [name]);

    if (rows.length === 0) return null;
    return mapRow(rows[0]);
  } catch {
    return null;
  }
}

export function listVectorIndexes(): VectorIndexRecord[] {
  try {
    const rows = query<{
      id: string;
      name: string;
      type: string;
      dimension: number;
      metric: string;
      params: string;
      status: string;
      last_rebuild_at: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(`SELECT * FROM vector_index_metadata ORDER BY updated_at DESC`);

    return rows.map(mapRow);
  } catch (error) {
    throw new DatabaseError('Failed to list vector indexes', error);
  }
}

export function updateVectorIndexStatus(id: string, status: VectorIndexRecord['status'], errorMessage?: string): void {
  const db = getDatabase();

  try {
    const update: string[] = ['status = ?', 'updated_at = datetime(\'now\')'];
    const values: unknown[] = [status];

    if (status === 'ready') {
      update.push('last_rebuild_at = datetime(\'now\')');
      update.push('error_message = NULL');
    }

    if (errorMessage) {
      update.push('error_message = ?');
      values.push(errorMessage);
    }

    values.push(id);
    db.run(`UPDATE vector_index_metadata SET ${update.join(', ')} WHERE id = ?`, castParams(values));
  } catch (error) {
    throw new DatabaseError('Failed to update vector index status', error);
  }
}

export function removeVectorIndex(id: string): void {
  try {
    query<{ id: string }>(`DELETE FROM vector_index_metadata WHERE id = ?`, [id]);

    if (!getVectorIndex(id)) {
      throw new DatabaseError('Vector index not found', new Error(id));
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError('Failed to remove vector index', error);
  }
}

export function ensureVectorIndexMetadata(name: string, dimension: number): VectorIndexRecord {
  const existing = getVectorIndexByName(name);

  if (existing) {
    if (existing.dimension !== dimension) {
      const rebuilt = registerVectorIndex({
        id: existing.id,
        name,
        dimension,
        type: existing.type,
        metric: existing.metric,
        params: existing.params
      });

      updateVectorIndexStatus(rebuilt.id, 'building');
      return rebuilt;
    }

    return existing;
  }

  const created = registerVectorIndex({
    id: `vindex-${name}`,
    name,
    dimension,
    metric: 'cosine'
  });

  updateVectorIndexStatus(created.id, 'building');
  return created;
}

function normalizeRecord(record: {
  id: string;
  name: string;
  dimension: number;
  type?: string;
  metric?: string;
  params?: Record<string, unknown>;
  status?: string;
  lastRebuildAt?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): {
  id: string;
  name: string;
  type: string;
  dimension: number;
  metric: string;
  params: Record<string, unknown>;
  status: string;
  lastRebuildAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: record.id,
    name: record.name,
    type: record.type ?? 'hnsw',
    dimension: record.dimension,
    metric: record.metric ?? 'cosine',
    params: record.params ?? {},
    status: record.status ?? 'building',
    lastRebuildAt: record.lastRebuildAt ?? null,
    errorMessage: record.errorMessage ?? null,
    createdAt: record.createdAt ?? new Date().toISOString(),
    updatedAt: record.updatedAt ?? new Date().toISOString()
  };
}

function mapRow(row: {
  id: string;
  name: string;
  type: string;
  dimension: number;
  metric: string;
  params: string;
  status: string;
  last_rebuild_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}): VectorIndexRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    dimension: row.dimension,
    metric: row.metric,
    params: safeParseJson(row.params),
    status: row.status,
    lastRebuildAt: row.last_rebuild_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed json and return empty object
  }

  return {};
}
