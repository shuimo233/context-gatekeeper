/**
 * Memory Tiers Service
 * Implements 3-tier memory architecture: session, short-term, long-term
 * with forgetting mechanism and semantic compression
 */

import { getDatabase, query, run } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';
import { Memory, IsolationContext } from '../models/types.js';
import { getMemoriesByIds, createMemory, deleteMemory } from '../schema/memory.js';
import { getContextCompressor } from './compressor/index.js';

export type MemoryTier = 'session' | 'short' | 'long';

export interface MemoryTierRecord {
  memoryId: string;
  tier: MemoryTier;
  accessCount: number;
  lastAccessedAt: Date;
  tierChangedAt: Date;
  importanceScore: number;
}

export interface TierConfig {
  sessionRetentionHours: number;
  shortRetentionDays: number;
  longPromotionThreshold: number;
  forgettingThreshold: number;
  maxTierSize: Record<MemoryTier, number>;
}

const DEFAULT_TIER_CONFIG: TierConfig = {
  sessionRetentionHours: 1,
  shortRetentionDays: 7,
  longPromotionThreshold: 0.8,
  forgettingThreshold: 0.2,
  maxTierSize: {
    session: 50,
    short: 500,
    long: 10000
  }
};

export interface TieredMemoryStats {
  sessionCount: number;
  shortCount: number;
  longCount: number;
  promotedCount: number;
  demotedCount: number;
  forgottenCount: number;
}

// ============ Schema ============

export function initMemoryTiers(): void {
  const db = getDatabase();
  
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_tiers (
        memory_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL CHECK (tier IN ('session', 'short', 'long')),
        access_count INTEGER NOT NULL DEFAULT 1,
        last_accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
        tier_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
        importance_score REAL NOT NULL DEFAULT 0.5,
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_tiers_tier ON memory_tiers(tier)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_tiers_accessed ON memory_tiers(last_accessed_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_tiers_importance ON memory_tiers(importance_score)`);
  } catch (error) {
    throw new DatabaseError('Failed to initialize memory tiers', error);
  }
}

// ============ Memory Tier Management ============

class MemoryTiersService {
  private config: TierConfig;
  
  constructor(config: Partial<TierConfig> = {}) {
    this.config = { ...DEFAULT_TIER_CONFIG, ...config };
  }
  
  /**
   * Assign a memory to a tier
   */
  async assignToTier(memoryId: string, tier: MemoryTier, importanceScore: number = 0.5): Promise<MemoryTierRecord> {
    const now = new Date().toISOString();
    
    try {
      // Check if already assigned
      const existing = query<TierRow>(`SELECT * FROM memory_tiers WHERE memory_id = ?`, [memoryId]);
      
      if (existing.length > 0) {
        // Update existing tier
        run(
          `UPDATE memory_tiers SET tier = ?, importance_score = ?, tier_changed_at = ?, last_accessed_at = ? WHERE memory_id = ?`,
          [tier, importanceScore, now, now, memoryId]
        );
      } else {
        // Create new tier record
        run(
          `INSERT INTO memory_tiers (memory_id, tier, importance_score, last_accessed_at, tier_changed_at) VALUES (?, ?, ?, ?, ?)`,
          [memoryId, tier, importanceScore, now, now]
        );
      }
      
      return this.getTierRecord(memoryId)!;
    } catch (error) {
      throw new DatabaseError('Failed to assign memory to tier', error);
    }
  }
  
  /**
   * Get tier record for a memory
   */
  getTierRecord(memoryId: string): MemoryTierRecord | null {
    try {
      const rows = query<TierRow>(`SELECT * FROM memory_tiers WHERE memory_id = ?`, [memoryId]);
      if (rows.length === 0) return null;
      return mapTierRow(rows[0]);
    } catch {
      return null;
    }
  }
  
  /**
   * Get memories by tier
   */
  getMemoriesByTier(tier: MemoryTier, isolation?: IsolationContext): Memory[] {
    try {
      let sql = `
        SELECT m.* FROM memories m
        JOIN memory_tiers t ON m.id = t.memory_id
        WHERE t.tier = ? AND m.deleted = 0
      `;
      const params: unknown[] = [tier];
      
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
      
      sql += ' ORDER BY t.importance_score DESC, t.last_accessed_at DESC';
      
      const rows = query<MemoryRow>(sql, params);
      return rows.map(mapMemoryRow);
    } catch (error) {
      throw new DatabaseError('Failed to get memories by tier', error);
    }
  }
  
  /**
   * Update tier assignment based on access patterns
   */
  async refreshTierAssignment(memoryId: string): Promise<MemoryTierRecord | null> {
    const record = this.getTierRecord(memoryId);
    if (!record) return null;
    
    // Increment access count
    run(
      `UPDATE memory_tiers SET access_count = access_count + 1, last_accessed_at = ? WHERE memory_id = ?`,
      [new Date().toISOString(), memoryId]
    );
    
    // Check for tier promotion/demotion
    const updatedRecord = this.getTierRecord(memoryId);
    if (!updatedRecord) return null;
    
    // Promote to long-term if high importance and many accesses
    if (updatedRecord.importanceScore >= this.config.longPromotionThreshold && 
        updatedRecord.accessCount >= 10 &&
        updatedRecord.tier !== 'long') {
      return this.assignToTier(memoryId, 'long', updatedRecord.importanceScore + 0.1);
    }
    
    return updatedRecord;
  }
  
  /**
   * Run tier maintenance - promote, demote, and forget memories
   */
  async runTierMaintenance(): Promise<TieredMemoryStats> {
    const stats: TieredMemoryStats = {
      sessionCount: 0,
      shortCount: 0,
      longCount: 0,
      promotedCount: 0,
      demotedCount: 0,
      forgottenCount: 0
    };
    
    const now = new Date();
    
    // Session tier: promote session memories to short-term after retention period
    const sessionRetentionMs = this.config.sessionRetentionHours * 60 * 60 * 1000;
    const sessionThreshold = new Date(now.getTime() - sessionRetentionMs);
    
    const sessionMemories = query<{ memory_id: string; importance_score: number }>(
      `SELECT memory_id, importance_score FROM memory_tiers WHERE tier = 'session' AND datetime(last_accessed_at) < datetime(?)`,
      [sessionThreshold.toISOString()]
    );
    
    for (const row of sessionMemories) {
      if (row.importance_score >= this.config.forgettingThreshold) {
        await this.assignToTier(row.memory_id, 'short', row.importance_score);
        stats.promotedCount++;
      } else {
        // Forget this memory
        await this.forgetMemory(row.memory_id);
        stats.forgottenCount++;
      }
    }
    
    // Short tier: promote important memories to long-term
    const shortMemories = query<{ memory_id: string; importance_score: number }>(
      `SELECT memory_id, importance_score FROM memory_tiers WHERE tier = 'short'`
    );
    
    for (const row of shortMemories) {
      if (row.importance_score >= this.config.longPromotionThreshold) {
        await this.assignToTier(row.memory_id, 'long', row.importance_score + 0.1);
        stats.promotedCount++;
      }
    }
    
    // Long tier: enforce max size (evict lowest importance)
    const longCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_tiers WHERE tier = 'long'`)[0]?.count ?? 0;
    
    if (longCount > this.config.maxTierSize.long) {
      const toDemote = query<{ memory_id: string }>(
        `SELECT memory_id FROM memory_tiers WHERE tier = 'long' ORDER BY importance_score ASC LIMIT ?`,
        [longCount - this.config.maxTierSize.long]
      );
      
      for (const row of toDemote) {
        await this.assignToTier(row.memory_id, 'short', 0.3);
        stats.demotedCount++;
      }
    }
    
    // Count tiers
    stats.sessionCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_tiers WHERE tier = 'session'`)[0]?.count ?? 0;
    stats.shortCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_tiers WHERE tier = 'short'`)[0]?.count ?? 0;
    stats.longCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_tiers WHERE tier = 'long'`)[0]?.count ?? 0;
    
    return stats;
  }
  
  /**
   * Forget a memory (soft delete with semantic compression)
   */
  private async forgetMemory(memoryId: string): Promise<void> {
    const memory = getMemoriesByIds([memoryId])[0];
    if (!memory) return;
    
    // Create a semantic compression before forgetting
    const compressor = getContextCompressor();
    await compressor.compress(0.9); // Compress to 90% reduction
    
    // Soft delete
    deleteMemory(memoryId);
  }
  
  /**
   * Create a new memory in session tier
   */
  async createTieredMemory(
    content: string,
    priority: Memory['priority'],
    importanceScore: number = 0.5,
    isolation?: IsolationContext
  ): Promise<Memory> {
    const memory = createMemory(
      {
        content,
        priority,
        userId: isolation?.userId,
        agentId: isolation?.agentId,
        projectId: isolation?.projectId
      }
    );
    
    await this.assignToTier(memory.id, 'session', importanceScore);
    
    return memory;
  }
  
  /**
   * Get tier statistics
   */
  getTierStats(): { tier: MemoryTier; count: number; avgImportance: number }[] {
    try {
      const rows = query<{ tier: string; count: number; avg_importance: number }>(
        `SELECT tier, COUNT(*) as count, AVG(importance_score) as avg_importance FROM memory_tiers GROUP BY tier`
      );
      
      return rows.map(row => ({
        tier: row.tier as MemoryTier,
        count: row.count,
        avgImportance: row.avg_importance
      }));
    } catch {
      return [];
    }
  }
}

// ============ Helper Types ============

interface TierRow {
  memory_id: string;
  tier: string;
  access_count: number;
  last_accessed_at: string;
  tier_changed_at: string;
  importance_score: number;
}

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

function mapTierRow(row: TierRow): MemoryTierRecord {
  return {
    memoryId: row.memory_id,
    tier: row.tier as MemoryTier,
    accessCount: row.access_count,
    lastAccessedAt: new Date(row.last_accessed_at),
    tierChangedAt: new Date(row.tier_changed_at),
    importanceScore: row.importance_score
  };
}

function mapMemoryRow(row: MemoryRow): Memory {
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

// ============ Singleton ============

let memoryTiersInstance: MemoryTiersService | null = null;

export function getMemoryTiersService(config?: Partial<TierConfig>): MemoryTiersService {
  if (!memoryTiersInstance) {
    memoryTiersInstance = new MemoryTiersService(config);
  }
  return memoryTiersInstance;
}

export function resetMemoryTiersService(): void {
  memoryTiersInstance = null;
}
