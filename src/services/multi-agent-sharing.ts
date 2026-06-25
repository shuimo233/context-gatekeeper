/**
 * Multi-Agent Sharing Service
 * Enables sharing memories and sessions across agents
 */

import { v4 as uuidv4 } from 'uuid';
import { getDatabase, query, run } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';
import { Memory } from '../models/types.js';
import { getMemory } from '../schema/memory.js';

export interface ShareConfig {
  shareToAgents: string[];
  shareToProjects: string[];
  permission: 'read' | 'read_write' | 'admin';
  expiresAt?: Date;
}

export interface SharedMemoryRecord {
  id: string;
  memoryId: string;
  sharedByAgentId: string;
  sharedToAgentId: string;
  sharedToProjectId: string;
  permission: string;
  sharedAt: Date;
  expiresAt: Date | null;
}

export interface ShareToken {
  token: string;
  memoryId: string;
  sharedByAgentId: string;
  permission: string;
  createdAt: Date;
  expiresAt: Date | null;
  useCount: number;
  maxUses: number | null;
}

export function initMultiAgentSharing(): void {
  const db = getDatabase();

  try {
    // Shared memories table
    db.run(`
      CREATE TABLE IF NOT EXISTS shared_memories (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        shared_by_agent_id TEXT NOT NULL,
        shared_to_agent_id TEXT NOT NULL,
        shared_to_project_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'read_write', 'admin')),
        shared_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shared_memories_to_agent ON shared_memories(shared_to_agent_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shared_memories_to_project ON shared_memories(shared_to_project_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_shared_memories_memory ON shared_memories(memory_id)`);

    // Share tokens table (for one-time or limited-use shares)
    db.run(`
      CREATE TABLE IF NOT EXISTS share_tokens (
        token TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        shared_by_agent_id TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'read_write')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        use_count INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER,
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_share_tokens_memory ON share_tokens(memory_id)`);

  } catch (error) {
    throw new DatabaseError('Failed to initialize multi-agent sharing', error);
  }
}

// ============ Direct Sharing ============

/**
 * Share a memory with specific agents
 */
export function shareMemoryToAgents(
  memoryId: string,
  sharedByAgentId: string,
  targetAgentIds: string[],
  targetProjectId: string,
  permission: ShareConfig['permission'] = 'read',
  expiresAt?: Date
): SharedMemoryRecord[] {
  const records: SharedMemoryRecord[] = [];

  for (const agentId of targetAgentIds) {
    const record = shareMemory(memoryId, sharedByAgentId, agentId, targetProjectId, permission, expiresAt);
    records.push(record);
  }

  return records;
}

/**
 * Share a memory to a project (all agents in project)
 */
export function shareMemoryToProject(
  memoryId: string,
  sharedByAgentId: string,
  targetProjectId: string,
  permission: ShareConfig['permission'] = 'read',
  expiresAt?: Date
): SharedMemoryRecord {
  // Use '*' as the agent ID to indicate project-wide sharing
  return shareMemory(memoryId, sharedByAgentId, '*', targetProjectId, permission, expiresAt);
}

/**
 * Internal share memory function
 */
function shareMemory(
  memoryId: string,
  sharedByAgentId: string,
  sharedToAgentId: string,
  sharedToProjectId: string,
  permission: ShareConfig['permission'],
  expiresAt?: Date
): SharedMemoryRecord {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO shared_memories (id, memory_id, shared_by_agent_id, shared_to_agent_id, shared_to_project_id, permission, shared_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        memoryId,
        sharedByAgentId,
        sharedToAgentId,
        sharedToProjectId,
        permission,
        now,
        expiresAt?.toISOString() || null
      ]
    );

    return {
      id,
      memoryId,
      sharedByAgentId,
      sharedToAgentId,
      sharedToProjectId,
      permission,
      sharedAt: new Date(now),
      expiresAt: expiresAt || null
    };
  } catch (error) {
    throw new DatabaseError('Failed to share memory', error);
  }
}

/**
 * Get shared memories for an agent
 */
export function getSharedMemoriesForAgent(
  agentId: string,
  projectId?: string,
  includeExpired: boolean = false
): Array<SharedMemoryRecord & { memory: Memory }> {
  try {
    let sql = `
      SELECT s.*, m.content, m.priority, m.project_tags, m.anchored, m.access_count, m.version, m.updated_by, m.parent_id, m.lineage, m.created_at as memory_created_at, m.updated_at as memory_updated_at, m.expires_at as memory_expires_at, m.deleted
      FROM shared_memories s
      JOIN memories m ON s.memory_id = m.id
      WHERE (s.shared_to_agent_id = ? OR s.shared_to_agent_id = '*')
      AND m.deleted = 0
    `;
    const params: unknown[] = [agentId];

    if (projectId) {
      sql += ' AND s.shared_to_project_id = ?';
      params.push(projectId);
    }

    if (!includeExpired) {
      sql += ' AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime(?))';
      params.push(new Date().toISOString());
    }

    sql += ' ORDER BY s.shared_at DESC';

    const rows = query<SharedMemoryRow & MemoryRow>(sql, params);

    return rows.map(row => ({
      id: row.id,
      memoryId: row.memory_id,
      sharedByAgentId: row.shared_by_agent_id,
      sharedToAgentId: row.shared_to_agent_id,
      sharedToProjectId: row.shared_to_project_id,
      permission: row.permission,
      sharedAt: new Date(row.shared_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      memory: mapMemoryRow(row)
    }));
  } catch (error) {
    throw new DatabaseError('Failed to get shared memories', error);
  }
}

/**
 * Revoke a shared memory
 */
export function revokeSharedMemory(shareId: string): void {
  try {
    run(`DELETE FROM shared_memories WHERE id = ?`, [shareId]);
  } catch (error) {
    throw new DatabaseError('Failed to revoke shared memory', error);
  }
}

/**
 * Revoke all shares of a memory
 */
export function revokeAllSharesForMemory(memoryId: string): number {
  try {
    const result = run(`DELETE FROM shared_memories WHERE memory_id = ?`, [memoryId]);
    return result.changes;
  } catch (error) {
    throw new DatabaseError('Failed to revoke shared memories', error);
  }
}

// ============ Token-Based Sharing ============

/**
 * Create a share token for a memory
 */
export function createShareToken(
  memoryId: string,
  sharedByAgentId: string,
  permission: 'read' | 'read_write' = 'read',
  options: {
    expiresAt?: Date;
    maxUses?: number;
  } = {}
): ShareToken {
  const token = uuidv4();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO share_tokens (token, memory_id, shared_by_agent_id, permission, created_at, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        memoryId,
        sharedByAgentId,
        permission,
        now,
        options.expiresAt?.toISOString() || null,
        options.maxUses || null
      ]
    );

    return {
      token,
      memoryId,
      sharedByAgentId,
      permission,
      createdAt: new Date(now),
      expiresAt: options.expiresAt || null,
      useCount: 0,
      maxUses: options.maxUses || null
    };
  } catch (error) {
    throw new DatabaseError('Failed to create share token', error);
  }
}

/**
 * Redeem a share token
 */
export function redeemShareToken(token: string): { memory: Memory; permission: string } | null {
  try {
    // Get token
    const tokenRows = query<ShareTokenRow>(
      `SELECT * FROM share_tokens WHERE token = ?`,
      [token]
    );

    if (tokenRows.length === 0) {
      return null;
    }

    const tokenRow = tokenRows[0];
    const now = new Date();

    // Check expiration
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < now) {
      return null;
    }

    // Check max uses
    if (tokenRow.max_uses !== null && tokenRow.use_count >= tokenRow.max_uses) {
      return null;
    }

    // Get memory
    const memory = getMemory(tokenRow.memory_id);
    if (!memory) {
      return null;
    }

    // Increment use count
    run(
      `UPDATE share_tokens SET use_count = use_count + 1 WHERE token = ?`,
      [token]
    );

    return {
      memory,
      permission: tokenRow.permission
    };
  } catch (error) {
    throw new DatabaseError('Failed to redeem share token', error);
  }
}

/**
 * Delete expired tokens
 */
export function cleanupExpiredTokens(): number {
  try {
    const result = run(
      `DELETE FROM share_tokens WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime(?)`,
      [new Date().toISOString()]
    );
    return result.changes;
  } catch (error) {
    throw new DatabaseError('Failed to cleanup expired tokens', error);
  }
}

// ============ Helper Types ============

interface SharedMemoryRow {
  id: string;
  memory_id: string;
  shared_by_agent_id: string;
  shared_to_agent_id: string;
  shared_to_project_id: string;
  permission: string;
  shared_at: string;
  expires_at: string | null;
}

interface ShareTokenRow {
  token: string;
  memory_id: string;
  shared_by_agent_id: string;
  permission: string;
  created_at: string;
  expires_at: string | null;
  use_count: number;
  max_uses: number | null;
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

function mapMemoryRow(row: MemoryRow & { memory_created_at?: string; memory_updated_at?: string; memory_expires_at?: string }): Memory {
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
    createdAt: new Date(row.memory_created_at || row.created_at),
    updatedAt: new Date(row.memory_updated_at || row.updated_at),
    expiresAt: row.memory_expires_at ? new Date(row.memory_expires_at) : (row.expires_at ? new Date(row.expires_at) : null),
    deleted: row.deleted === 1
  };
}

// ============ Service Wrapper ============

export function getMultiAgentSharingService() {
  return {
    shareMemoryToAgents,
    shareMemoryToProject,
    getSharedMemoriesForAgent,
    revokeSharedMemory,
    revokeAllSharesForMemory,
    createShareToken,
    redeemShareToken,
    cleanupExpiredTokens
  };
}
