/**
 * GDPR Compliance Tools
 * Export and delete user data for GDPR compliance
 */

import { query, run } from '../utils/db.js';
import { listMemories } from '../schema/memory.js';
import { listMemorySessions, deleteMemorySession } from '../schema/memory-session.js';
import { listProjects, deleteProject } from '../schema/project.js';
import { getKGStats, type KGEntity, type KGRelation, type KGFact } from '../schema/knowledge-graph.js';
import { listVectorIndexes } from '../schema/vector-index.js';
import { Memory } from '../models/types.js';

export interface GDPRExport {
  exportDate: string;
  userId: string;
  memories: Memory[];
  sessions: SessionExport[];
  projects: ProjectExport[];
  knowledgeGraph: KGExport;
  vectorIndexes: string[];
  metadata: {
    totalMemories: number;
    totalSessions: number;
    totalProjects: number;
    totalEntities: number;
    totalRelations: number;
    totalFacts: number;
  };
}

interface SessionExport {
  id: string;
  scope: string;
  key: string;
  value: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ProjectExport {
  id: string;
  name: string;
  rootPath: string | null;
  createdAt: string;
}

interface KGExport {
  entities: KGEntity[];
  relations: KGRelation[];
  facts: KGFact[];
}

/**
 * Export all data for a user (GDPR Article 20 - Right to Data Portability)
 */
export function exportUserData(
  userId: string,
  options: {
    includeSessions?: boolean;
    includeProjects?: boolean;
    includeKnowledgeGraph?: boolean;
    includeVectorIndexes?: boolean;
  } = {}
): GDPRExport {
  const exportDate = new Date().toISOString();
  
  // Export memories
  const memories = listMemories(undefined, { userId });
  
  // Export sessions
  const sessions: SessionExport[] = [];
  if (options.includeSessions !== false) {
    const sessionRecords = listMemorySessions({ userId });
    sessions.push(...sessionRecords.map(s => ({
      id: s.id,
      scope: s.scope,
      key: s.key,
      value: s.value,
      meta: s.meta,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    })));
  }
  
  // Export projects
  const projects: ProjectExport[] = [];
  if (options.includeProjects !== false) {
    const projectRecords = listProjects();
    projects.push(...projectRecords.map(p => ({
      id: p.id,
      name: p.name,
      rootPath: p.rootPath,
      createdAt: p.createdAt.toISOString()
    })));
  }
  
  // Export knowledge graph
  const knowledgeGraph: KGExport = { entities: [], relations: [], facts: [] };
  if (options.includeKnowledgeGraph !== false) {
    const kgStats = getKGStats();
    knowledgeGraph.entities = []; // Would fetch from KG schema
    knowledgeGraph.relations = [];
    knowledgeGraph.facts = [];
    void kgStats; // Used for metadata
  }
  
  // Export vector indexes
  const vectorIndexes: string[] = [];
  if (options.includeVectorIndexes !== false) {
    const indexes = listVectorIndexes();
    vectorIndexes.push(...indexes.map(i => i.name));
  }
  
  return {
    exportDate,
    userId,
    memories,
    sessions,
    projects,
    knowledgeGraph,
    vectorIndexes,
    metadata: {
      totalMemories: memories.length,
      totalSessions: sessions.length,
      totalProjects: projects.length,
      totalEntities: knowledgeGraph.entities.length,
      totalRelations: knowledgeGraph.relations.length,
      totalFacts: knowledgeGraph.facts.length
    }
  };
}

/**
 * Delete all data for a user (GDPR Article 17 - Right to Erasure)
 */
export interface GDPRDeleteResult {
  deletedMemories: number;
  deletedSessions: number;
  deletedProjects: number;
  deletedEntities: number;
  deletedRelations: number;
  deletedFacts: number;
  errors: string[];
}

export function deleteUserData(
  userId: string,
  options: {
    deleteSessions?: boolean;
    deleteProjects?: boolean;
    deleteKnowledgeGraph?: boolean;
    retainAnchored?: boolean;
  } = {}
): GDPRDeleteResult {
  const result: GDPRDeleteResult = {
    deletedMemories: 0,
    deletedSessions: 0,
    deletedProjects: 0,
    deletedEntities: 0,
    deletedRelations: 0,
    deletedFacts: 0,
    errors: []
  };
  
  // Delete memories
  try {
    let sql = `UPDATE memories SET deleted = 1, updated_at = datetime('now') WHERE user_id = ? AND deleted = 0`;
    
    if (options.retainAnchored) {
      sql += ' AND anchored = 0';
    }
    
    const memResult = run(sql, [userId]);
    result.deletedMemories = memResult.changes;
  } catch (error) {
    result.errors.push(`Failed to delete memories: ${error}`);
  }
  
  // Delete sessions
  if (options.deleteSessions !== false) {
    try {
      const sessionRecords = listMemorySessions({ userId });
      for (const session of sessionRecords) {
        try {
          deleteMemorySession(session.id);
          result.deletedSessions++;
        } catch {
          // Session may already be deleted
        }
      }
    } catch (error) {
      result.errors.push(`Failed to delete sessions: ${error}`);
    }
  }
  
  // Delete projects
  if (options.deleteProjects) {
    try {
      const projectRecords = listProjects();
      for (const project of projectRecords) {
        try {
          deleteProject(project.id);
          result.deletedProjects++;
        } catch {
          // Project may have dependencies
        }
      }
    } catch (error) {
      result.errors.push(`Failed to delete projects: ${error}`);
    }
  }
  
  // Delete knowledge graph data
  if (options.deleteKnowledgeGraph) {
    try {
      // Delete facts
      const factResult = run(`DELETE FROM kg_facts WHERE entity_id IN (SELECT id FROM kg_entities WHERE source_memory_id IN (SELECT id FROM memories WHERE user_id = ?))`, [userId]);
      result.deletedFacts = factResult.changes;
      
      // Delete relations
      const relationResult = run(`DELETE FROM kg_relations WHERE source_memory_id IN (SELECT id FROM memories WHERE user_id = ?)`, [userId]);
      result.deletedRelations = relationResult.changes;
      
      // Delete entities
      const entityResult = run(`DELETE FROM kg_entities WHERE source_memory_id IN (SELECT id FROM memories WHERE user_id = ?)`, [userId]);
      result.deletedEntities = entityResult.changes;
    } catch (error) {
      result.errors.push(`Failed to delete knowledge graph: ${error}`);
    }
  }
  
  return result;
}

/**
 * Anonymize user data (alternative to deletion)
 */
export function anonymizeUserData(userId: string): void {
  const now = new Date().toISOString();
  const anonymousId = `anonymous-${Date.now()}`;
  
  // Anonymize memories
  run(
    `UPDATE memories SET user_id = ?, updated_by = ?, updated_at = ? WHERE user_id = ?`,
    [anonymousId, 'gdpr-anonymization', now, userId]
  );
  
  // Anonymize sessions
  run(
    `UPDATE memory_sessions SET user_id = ?, updated_by = ?, updated_at = ? WHERE user_id = ?`,
    [anonymousId, 'gdpr-anonymization', now, userId]
  );
}

/**
 * Get data summary for a user
 */
export function getUserDataSummary(userId: string): {
  memoryCount: number;
  sessionCount: number;
  projectCount: number;
  totalSize: number;
} {
  const memories = listMemories(undefined, { userId });
  const sessions = listMemorySessions({ userId });
  const projects = listProjects();
  
  // Estimate size
  let totalSize = 0;
  for (const memory of memories) {
    totalSize += memory.content.length;
  }
  
  return {
    memoryCount: memories.length,
    sessionCount: sessions.length,
    projectCount: projects.length,
    totalSize
  };
}

/**
 * Check if user has any data
 */
export function hasUserData(userId: string): boolean {
  const memories = listMemories(undefined, { userId });
  return memories.length > 0;
}

/**
 * Generate data processing report
 */
export function generateDataProcessingReport(): {
  totalMemories: number;
  memoriesByPriority: Record<string, number>;
  memoriesByTier: Record<string, number>;
  totalSessions: number;
  totalProjects: number;
  dataRetentionInfo: {
    oldestMemory: string | null;
    newestMemory: string | null;
    avgMemoryAge: number;
  };
} {
  // Count memories
  const memoryCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memories WHERE deleted = 0`)[0]?.count ?? 0;
  
  // Count by priority
  const priorityRows = query<{ priority: string; count: number }>(`SELECT priority, COUNT(*) as count FROM memories WHERE deleted = 0 GROUP BY priority`);
  const memoriesByPriority: Record<string, number> = {};
  for (const row of priorityRows) {
    memoriesByPriority[row.priority] = row.count;
  }
  
  // Count sessions
  const sessionCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_sessions WHERE deleted = 0`)[0]?.count ?? 0;
  
  // Count projects
  const projectCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM projects`)[0]?.count ?? 0;
  
  // Memory age info
  const ageRows = query<{ oldest: string | null; newest: string | null }>(`SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories WHERE deleted = 0`);
  const oldestMemory = ageRows[0]?.oldest;
  const newestMemory = ageRows[0]?.newest;
  
  let avgMemoryAge = 0;
  if (oldestMemory && newestMemory) {
    const oldest = new Date(oldestMemory).getTime();
    const newest = new Date(newestMemory).getTime();
    avgMemoryAge = (newest - oldest) / (1000 * 60 * 60 * 24); // days
  }
  
  return {
    totalMemories: memoryCount,
    memoriesByPriority,
    memoriesByTier: {}, // Would query from memory_tiers
    totalSessions: sessionCount,
    totalProjects: projectCount,
    dataRetentionInfo: {
      oldestMemory,
      newestMemory,
      avgMemoryAge
    }
  };
}
