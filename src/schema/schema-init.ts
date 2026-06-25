import { logger } from '../utils/logger.js';
import { getDatabase } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';
import { initFullTextSearch } from './fulltext-search.js';
import { initMemorySessions } from './memory-session.js';
import { initHNSWIndex } from '../services/hnsw-index.js';
import { initKnowledgeGraph } from './knowledge-graph.js';
import { initMemoryTiers } from '../services/memory-tiers.js';
import { initMultiAgentSharing } from '../services/multi-agent-sharing.js';

/**
 * Safely add a column to a table if it doesn't exist.
 * Returns true if column was added or already exists.
 */
function addColumnIfNotExists(db: ReturnType<typeof getDatabase>, table: string, column: string, definition: string): boolean {
  try {
    // First check if table exists
    const tableCheck = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`);
    if (tableCheck.length === 0 || tableCheck[0].values.length === 0) {
      // Table doesn't exist yet - will be created by CREATE TABLE, no migration needed
      return true;
    }

    const result = db.exec(`PRAGMA table_info(${table})`);
    const columns = result[0]?.values?.map((row: unknown[]) => (row as unknown[])[1] as string) || [];
    
    if (!columns.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    return true;
  } catch (error) {
    // Ignore duplicate column name (column already exists)
    if (error instanceof Error && (error.message.includes('duplicate column name') || error.message.includes('no such table'))) {
      return true;
    }
    // Log other errors but don't throw - graceful degradation
    logger.warn(`Failed to add column ${table}.${column}`, { table, column, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Migrate existing schema to add new columns for multi-agent support.
 * Called BEFORE any CREATE INDEX statements to ensure columns exist first.
 */
function migrateSchema(): void {
  const db = getDatabase();

  // Migrate memories table - add new columns if they don't exist
  const memoriesColumns = [
    { name: 'user_id', def: "TEXT DEFAULT 'default'" },
    { name: 'agent_id', def: "TEXT DEFAULT 'default'" },
    { name: 'project_id', def: "TEXT DEFAULT 'default'" },
    { name: 'parent_id', def: 'TEXT' },
    { name: 'lineage', def: "TEXT DEFAULT '[]'" },
  ];

  for (const col of memoriesColumns) {
    addColumnIfNotExists(db, 'memories', col.name, col.def);
  }

  // Migrate memory_sessions table - add new columns if they don't exist
  const sessionsColumns = [
    { name: 'user_id', def: "TEXT DEFAULT 'default'" },
    { name: 'agent_id', def: "TEXT DEFAULT 'default'" },
    { name: 'project_id', def: "TEXT DEFAULT 'default'" },
  ];

  for (const col of sessionsColumns) {
    addColumnIfNotExists(db, 'memory_sessions', col.name, col.def);
  }
}

export function initSchema(): void {
  const db = getDatabase();
  
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        agent_id TEXT NOT NULL DEFAULT 'default',
        project_id TEXT NOT NULL DEFAULT 'default',
        content TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('anchored', 'constraint', 'decision', 'preference', 'fact')),
        project_tags TEXT NOT NULL DEFAULT '[]',
        anchored INTEGER NOT NULL DEFAULT 0,
        access_count INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        updated_by TEXT,
        parent_id TEXT,
        lineage TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT,
        deleted INTEGER NOT NULL DEFAULT 0
      )
    `);
    
    // Run migrations BEFORE creating indexes that depend on new columns
    migrateSchema();
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_priority ON memories(priority)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_anchored ON memories(anchored)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_project_tags ON memories(project_tags)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_user_agent_project ON memories(user_id, agent_id, project_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_lineage ON memories(lineage)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_memories_parent_id ON memories(parent_id)`);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS compressions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK (operation IN ('snapshot', 'update', 'merge', 'archive')),
        delta TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_compressions_memory_id ON compressions(memory_id)`);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        root_path TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    
    db.run(`
      CREATE TABLE IF NOT EXISTS memory_project_tags (
        memory_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (memory_id, tag),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        embedding TEXT NOT NULL,
        embedding_model TEXT,
        embedding_model_version TEXT,
        embedding_dimension INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (memory_id) REFERENCES memories(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS vector_index_metadata (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('hnsw', 'ivf', 'flat', 'custom')) DEFAULT 'hnsw',
        dimension INTEGER NOT NULL,
        metric TEXT NOT NULL CHECK (metric IN ('cosine', 'l2', 'ip')) DEFAULT 'cosine',
        params TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'error', 'stale')) DEFAULT 'building',
        last_rebuild_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_index_metadata_status ON vector_index_metadata(status)`);

    // Initialize Full-Text Search (wrapped in try/catch for graceful degradation - FTS5 may not be available in sql.js)
    try {
      initFullTextSearch();
    } catch (error) {
      logger.warn('Failed to initialize FTS5 full-text search', { error: error instanceof Error ? error.message : String(error) });
    }
    initMemorySessions();
    
    // Initialize HNSW index (wrapped in try/catch for graceful degradation)
    try {
      initHNSWIndex('default');
    } catch (error) {
      logger.warn('Failed to initialize HNSW index', { error: error instanceof Error ? error.message : String(error) });
    }
    
    // Initialize Knowledge Graph (wrapped in try/catch for graceful degradation)
    try {
      initKnowledgeGraph();
    } catch (error) {
      logger.warn('Failed to initialize Knowledge Graph', { error: error instanceof Error ? error.message : String(error) });
    }
    
    // Initialize Memory Tiers (wrapped in try/catch for graceful degradation)
    try {
      initMemoryTiers();
    } catch (error) {
      logger.warn('Failed to initialize Memory Tiers', { error: error instanceof Error ? error.message : String(error) });
    }
    
    // Initialize Multi-Agent Sharing (wrapped in try/catch for graceful degradation)
    try {
      initMultiAgentSharing();
    } catch (error) {
      logger.warn('Failed to initialize Multi-Agent Sharing', { error: error instanceof Error ? error.message : String(error) });
    }

  } catch (error) {
    throw new DatabaseError('Failed to initialize schema', error);
  }
}
