import { v4 as uuidv4 } from 'uuid';
import { query, run } from '../utils/db.js';
import { Memory, CreateMemoryInput, UpdateMemoryInput } from '../models/types.js';
import { DatabaseError, MemoryNotFoundError } from '../utils/errors.js';
import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

interface MemoryRow {
  id: string;
  user_id: string;
  agent_id: string;
  project_id: string;
  content: string;
  priority: string;
  project_tags: string;
  anchored: number;
  access_count: number;
  version: number;
  updated_by: string | null;
  parent_id: string | null;
  lineage: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  deleted: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    projectId: row.project_id,
    content: row.content,
    priority: row.priority as Memory['priority'],
    projectTags: JSON.parse(row.project_tags || '[]'),
    anchored: row.anchored === 1,
    accessCount: row.access_count,
    version: row.version,
    updatedBy: row.updated_by,
    parentId: row.parent_id,
    lineage: JSON.parse(row.lineage || '[]'),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    deleted: row.deleted === 1
  };
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function findDuplicateByHash(hash: string, isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory | null {
  try {
    let sql = `
      SELECT m.* FROM memories m
      JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE e.content_hash = ? AND m.deleted = 0
    `;
    const params: unknown[] = [hash];

    if (isolation?.userId) {
      sql += ' AND m.user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND m.agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND m.project_id = ?';
      params.push(isolation.projectId);
    }

    const results = query<MemoryRow>(sql, params);

    return results.length > 0 ? rowToMemory(results[0]) : null;
  } catch {
    return null;
  }
}

export function storeEmbedding(
  memoryId: string,
  content: string,
  embedding: number[],
  embeddingModel: string = 'fixed-tfidf',
  embeddingModelVersion: string = 'v1',
  embeddingDimension: number = 4096
): void {
  const contentHash = computeContentHash(content);

  try {
    run(`
      INSERT OR REPLACE INTO memory_embeddings (memory_id, content_hash, embedding, embedding_model, embedding_model_version, embedding_dimension, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `, [memoryId, contentHash, JSON.stringify(embedding), embeddingModel, embeddingModelVersion, embeddingDimension]);
  } catch (error) {
    throw new DatabaseError('Failed to store embedding', error);
  }
}

export function getEmbedding(memoryId: string): { embedding: number[]; model: string; modelVersion: string; dimension: number } | null {
  try {
    const results = query<{ embedding: string; embedding_model: string | null; embedding_model_version: string | null; embedding_dimension: number | null }>(
      `SELECT embedding, embedding_model, embedding_model_version, embedding_dimension FROM memory_embeddings WHERE memory_id = ?`,
      [memoryId]
    );

    if (results.length === 0) return null;

    const row = results[0];
    const parsedEmbedding = JSON.parse(row.embedding) as number[];
    const modelVersion = row.embedding_model_version || 'legacy';
    const dimension = typeof row.embedding_dimension === 'number' ? row.embedding_dimension : parsedEmbedding.length;

    return {
      embedding: parsedEmbedding,
      model: row.embedding_model || 'simple-tfidf',
      modelVersion,
      dimension
    };
  } catch {
    return null;
  }
}

export function searchMemoriesBM25(
  queryText: string,
  projectTags?: string[],
  limit: number = 10,
  isolation?: { userId?: string; agentId?: string; projectId?: string }
): Memory[] {
  return searchMemoriesLike(queryText, projectTags, limit, isolation);
}

function searchMemoriesLike(
  queryText: string,
  projectTags?: string[],
  limit: number = 10,
  isolation?: { userId?: string; agentId?: string; projectId?: string }
): Memory[] {
  if (!queryText || queryText.trim().length === 0) {
    return listMemories(projectTags, isolation);
  }

  try {
    const words = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    if (words.length === 0) {
      return listMemories(projectTags, isolation);
    }

    const likePatterns = words.map(() => 'LOWER(content) LIKE ?');
    const params: unknown[] = words.map(w => `%${w}%`);

    let sql = `
      SELECT * FROM memories
      WHERE deleted = 0 AND (${likePatterns.join(' OR ')})
    `;

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    if (projectTags && projectTags.length > 0) {
      const tagConditions = projectTags.map(() => `
        EXISTS (SELECT 1 FROM memory_project_tags t WHERE t.memory_id = memories.id AND t.tag = ?)
      `).join(' AND ');
      sql += ' AND ' + tagConditions;
      params.push(...projectTags);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  } catch (error) {
    throw new DatabaseError('Failed to search memories', error);
  }
}

export function searchMemoriesVector(
  queryEmbedding: number[],
  projectTags?: string[],
  limit: number = 10,
  minSimilarity: number = 0.1,
  isolation?: { userId?: string; agentId?: string; projectId?: string }
): Array<Memory & { similarity: number }> {
  try {
    let sql = `
      SELECT m.*, e.embedding, e.embedding_model_version
      FROM memories m
      JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE m.deleted = 0
    `;
    const params: unknown[] = [];

    if (isolation?.userId) {
      sql += ' AND m.user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND m.agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND m.project_id = ?';
      params.push(isolation.projectId);
    }

    if (projectTags && projectTags.length > 0) {
      const tagConditions = projectTags.map(() => `
        EXISTS (SELECT 1 FROM memory_project_tags t WHERE t.memory_id = m.id AND t.tag = ?)
      `).join(' AND ');
      sql += ' AND ' + tagConditions;
      params.push(...projectTags);
    }

    const rows = query<MemoryRow & { embedding: string; embedding_model_version: string | null }>(sql, params);
    const queryDimension = queryEmbedding.length;
    const results: Array<Memory & { similarity: number }> = [];

    for (const row of rows) {
      const candidateEmbedding = JSON.parse(row.embedding) as number[];
      const embeddingVersion = row.embedding_model_version || 'legacy';
      const memoryDimension = candidateEmbedding.length;

      if (embeddingVersion === 'legacy') {
        const fallback = computeLegacyCompatibilityScore(queryEmbedding, candidateEmbedding, queryDimension, memoryDimension);
        if (fallback >= minSimilarity) {
          results.push({
            ...rowToMemory(row),
            similarity: fallback
          });
        }
        continue;
      }

      if (memoryDimension !== queryDimension) {
        continue;
      }

      const similarity = cosineSimilarity(queryEmbedding, candidateEmbedding);

      if (similarity >= minSimilarity) {
        results.push({
          ...rowToMemory(row),
          similarity
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  } catch (error) {
    throw new DatabaseError('Failed to search memories by vector', error);
  }
}

export function searchMemoriesHybrid(
  queryText: string,
  queryEmbedding: number[],
  projectTags?: string[],
  limit: number = 10,
  bm25Weight: number = 0.5,
  vectorWeight: number = 0.5,
  isolation?: { userId?: string; agentId?: string; projectId?: string }
): Array<Memory & { bm25Score: number; similarity: number; combinedScore: number }> {
  try {
    let sql = `
      SELECT m.*, e.embedding, e.embedding_model_version
      FROM memories m
      JOIN memory_embeddings e ON m.id = e.memory_id
      WHERE m.deleted = 0
    `;
    const params: unknown[] = [];

    if (isolation?.userId) {
      sql += ' AND m.user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND m.agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND m.project_id = ?';
      params.push(isolation.projectId);
    }

    if (projectTags && projectTags.length > 0) {
      const tagConditions = projectTags.map(() => `
        EXISTS (SELECT 1 FROM memory_project_tags t WHERE t.memory_id = m.id AND t.tag = ?)
      `).join(' AND ');
      sql += ' AND ' + tagConditions;
      params.push(...projectTags);
    }

    const rows = query<MemoryRow & { embedding: string; embedding_model_version: string | null }>(sql, params);
    const results: Array<Memory & { bm25Score: number; similarity: number; combinedScore: number }> = [];
    const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 1);

    for (const row of rows) {
      const memory = rowToMemory(row);
      const candidateEmbedding = JSON.parse(row.embedding);
      const embeddingVersion = row.embedding_model_version || 'legacy';
      const memoryDimension = Array.isArray(candidateEmbedding) ? candidateEmbedding.length : 0;
      const queryDimension = queryEmbedding.length;

      let similarity = 0;

      if (embeddingVersion !== 'legacy' && memoryDimension === queryDimension) {
        similarity = cosineSimilarity(queryEmbedding, candidateEmbedding);
      } else {
        similarity = computeLegacyCompatibilityScore(queryEmbedding, candidateEmbedding, queryDimension, memoryDimension);
      }

      let bm25Score = 0;
      const contentLower = memory.content.toLowerCase();
      for (const term of queryTerms) {
        if (contentLower.includes(term)) {
          bm25Score += 1;
        }
      }
      bm25Score = bm25Score / Math.max(queryTerms.length, 1);

      const combinedScore = (bm25Weight * bm25Score) + (vectorWeight * similarity);

      results.push({
        ...memory,
        bm25Score,
        similarity,
        combinedScore
      });
    }

    results.sort((a, b) => b.combinedScore - a.combinedScore);
    return results.slice(0, limit);
  } catch (error) {
    throw new DatabaseError('Failed to perform hybrid search', error);
  }
}

function computeLegacyCompatibilityScore(queryEmbedding: number[], candidateEmbedding: number[], queryDimension: number, candidateDimension: number): number {
  const aligned = alignEmbeddings(queryEmbedding, candidateEmbedding, queryDimension, candidateDimension);
  if (!aligned) {
    return 0;
  }

  return cosineSimilarity(aligned.query, aligned.candidate);
}

function alignEmbeddings(queryEmbedding: number[], candidateEmbedding: number[], queryDimension: number, candidateDimension: number): { query: number[]; candidate: number[] } | null {
  if (queryDimension === candidateDimension) {
    return { query: queryEmbedding, candidate: candidateEmbedding };
  }

  const minDimension = Math.min(queryDimension, candidateDimension);
  const maxDimension = Math.max(queryDimension, candidateDimension);

  if (minDimension === 0 || maxDimension === 0) {
    return null;
  }

  const querySubset = queryEmbedding.slice(0, minDimension);
  const candidateSubset = candidateEmbedding.slice(0, minDimension);

  if (maxDimension === minDimension) {
    return { query: querySubset, candidate: candidateSubset };
  }

  const normalizedQuery = new Array(maxDimension).fill(0);
  const normalizedCandidate = new Array(maxDimension).fill(0);

  for (let i = 0; i < minDimension; i++) {
    normalizedQuery[i] = querySubset[i];
    normalizedCandidate[i] = candidateSubset[i];
  }

  return { query: normalizedQuery, candidate: normalizedCandidate };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function deleteEmbedding(memoryId: string): void {
  try {
    run('DELETE FROM memory_embeddings WHERE memory_id = ?', [memoryId]);
  } catch (error) {
    logger.error('Failed to delete embedding', { memoryId, error: error instanceof Error ? error.message : String(error) });
  }
}

export function cleanupExpiredMemories(): number {
  try {
    const result = run(`
      UPDATE memories
      SET deleted = 1, updated_at = datetime('now')
      WHERE expires_at IS NOT NULL
        AND datetime(expires_at) < datetime('now')
        AND deleted = 0
        AND anchored = 0
    `);
    return result.changes;
  } catch (error) {
    throw new DatabaseError('Failed to cleanup expired memories', error);
  }
}

export function createMemory(input: CreateMemoryInput, updatedBy?: string): Memory {
  const id = uuidv4();
  const now = new Date().toISOString();
  const userId = input.userId || 'default';
  const agentId = input.agentId || 'default';
  const projectId = input.projectId || 'default';
  const parentId = input.parentId || null;
  const lineage: string[] = parentId ? [parentId] : [];

  try {
    run(`
      INSERT INTO memories (id, user_id, agent_id, project_id, content, priority, project_tags, anchored, created_at, updated_at, expires_at, updated_by, parent_id, lineage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      userId,
      agentId,
      projectId,
      input.content,
      input.priority,
      JSON.stringify(input.projectTags || []),
      input.anchored ? 1 : 0,
      now,
      now,
      input.expiresAt?.toISOString() || null,
      updatedBy || null,
      parentId,
      JSON.stringify(lineage)
    ]);

    if (input.projectTags && input.projectTags.length > 0) {
      for (const tag of input.projectTags) {
        run(
          `INSERT OR IGNORE INTO memory_project_tags (memory_id, tag) VALUES (?, ?)`,
          [id, tag]
        );
      }
    }

    return getMemory(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create memory', error);
  }
}

export function getMemory(id: string, isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory | null {
  try {
    let sql = `SELECT * FROM memories WHERE id = ? AND deleted = 0`;
    const params: unknown[] = [id];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    const results = query<MemoryRow>(sql, params);
    return results.length > 0 ? rowToMemory(results[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get memory', error);
  }
}

export function getMemoryOrThrow(id: string, isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory {
  const memory = getMemory(id, isolation);
  if (!memory) {
    throw new MemoryNotFoundError(id);
  }
  return memory;
}

export function updateMemory(id: string, input: UpdateMemoryInput, updatedBy?: string, isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory {
  const now = new Date().toISOString();

  getMemoryOrThrow(id, isolation);

  try {
    const updates: string[] = ['version = version + 1', 'updated_at = ?'];
    const values: unknown[] = [now];

    if (input.content !== undefined) {
      updates.push('content = ?');
      values.push(input.content);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      values.push(input.priority);
    }
    if (input.anchored !== undefined) {
      updates.push('anchored = ?');
      values.push(input.anchored ? 1 : 0);
    }
    if (input.projectTags !== undefined) {
      updates.push('project_tags = ?');
      values.push(JSON.stringify(input.projectTags));
    }
    if (input.expiresAt !== undefined) {
      updates.push('expires_at = ?');
      values.push(input.expiresAt?.toISOString() || null);
    }
    if (input.deleted !== undefined) {
      updates.push('deleted = ?');
      values.push(input.deleted ? 1 : 0);
    }
    if (updatedBy) {
      updates.push('updated_by = ?');
      values.push(updatedBy);
    }

    let sql = `UPDATE memories SET ${updates.join(', ')} WHERE id = ? AND deleted = 0`;
    const params: unknown[] = [...values, id];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    run(sql, params);

    if (input.projectTags !== undefined) {
      run('DELETE FROM memory_project_tags WHERE memory_id = ?', [id]);
      for (const tag of input.projectTags) {
        run(
          `INSERT OR IGNORE INTO memory_project_tags (memory_id, tag) VALUES (?, ?)`,
          [id, tag]
        );
      }
    }

    return getMemoryOrThrow(id, isolation);
  } catch (error) {
    if (error instanceof MemoryNotFoundError) throw error;
    throw new DatabaseError('Failed to update memory', error);
  }
}

export function deleteMemory(id: string, _updatedBy?: string, isolation?: { userId?: string; agentId?: string; projectId?: string }): void {
  const now = new Date().toISOString();

  try {
    let sql = `
      UPDATE memories
      SET deleted = 1, updated_at = ?, version = version + 1
      WHERE id = ? AND deleted = 0
    `;
    const params: unknown[] = [now, id];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    const result = run(sql, params);

    if (result.changes === 0) {
      throw new MemoryNotFoundError(id);
    }

    deleteEmbedding(id);
  } catch (error) {
    if (error instanceof MemoryNotFoundError) throw error;
    throw new DatabaseError('Failed to delete memory', error);
  }
}

export function listMemories(projectTags?: string[], isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory[] {
  try {
    let sql = 'SELECT * FROM memories WHERE deleted = 0';
    const params: unknown[] = [];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    if (projectTags && projectTags.length > 0) {
      const tagConditions = projectTags.map(() => `
        EXISTS (SELECT 1 FROM memory_project_tags t WHERE t.memory_id = memories.id AND t.tag = ?)
      `).join(' AND ');
      sql += ' AND ' + tagConditions;
      params.push(...projectTags);
    }

    sql += ' ORDER BY updated_at DESC';

    const rows = query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  } catch (error) {
    throw new DatabaseError('Failed to list memories', error);
  }
}

export function searchMemories(searchQuery: string, projectTags?: string[], limit: number = 10, isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory[] {
  try {
    let sql = `
      SELECT * FROM memories
      WHERE deleted = 0 AND content LIKE ?
    `;
    const params: unknown[] = [`%${searchQuery}%`];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    if (projectTags && projectTags.length > 0) {
      const tagConditions = projectTags.map(() => `
        EXISTS (SELECT 1 FROM memory_project_tags t WHERE t.memory_id = memories.id AND t.tag = ?)
      `).join(' AND ');
      sql += ' AND ' + tagConditions;
      params.push(...projectTags);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const rows = query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  } catch (error) {
    throw new DatabaseError('Failed to search memories', error);
  }
}

export function incrementAccessCount(id: string): void {
  try {
    run(`UPDATE memories SET access_count = access_count + 1 WHERE id = ? AND deleted = 0`, [id]);
  } catch (error) {
    throw new DatabaseError('Failed to increment access count', error);
  }
}

export function anchorMemory(id: string): Memory {
  return updateMemory(id, { anchored: true });
}

export function getMemoriesByIds(ids: string[], isolation?: { userId?: string; agentId?: string; projectId?: string }): Memory[] {
  if (ids.length === 0) return [];

  try {
    let sql = `SELECT * FROM memories WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted = 0`;
    const params: unknown[] = [...ids];

    if (isolation?.userId) {
      sql += ' AND user_id = ?';
      params.push(isolation.userId);
    }
    if (isolation?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(isolation.agentId);
    }
    if (isolation?.projectId) {
      sql += ' AND project_id = ?';
      params.push(isolation.projectId);
    }

    const rows = query<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  } catch (error) {
    throw new DatabaseError('Failed to get memories by IDs', error);
  }
}

// Export isolation helper functions
export function buildIsolationFilter(isolation?: { userId?: string; agentId?: string; projectId?: string }): { sql: string; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];

  if (isolation?.userId) {
    sql.push('user_id = ?');
    params.push(isolation.userId);
  }
  if (isolation?.agentId) {
    sql.push('agent_id = ?');
    params.push(isolation.agentId);
  }
  if (isolation?.projectId) {
    sql.push('project_id = ?');
    params.push(isolation.projectId);
  }

  return {
    sql: sql.length > 0 ? ' AND ' + sql.join(' AND ') : '',
    params
  };
}
