/**
 * HNSW (Hierarchical Navigable Small World) Index Simulation Layer
 * Provides approximate nearest neighbor (ANN) search using a layered graph structure
 * 
 * HNSW Parameters:
 * - M: number of connections per layer (default 16)
 * - efConstruction: search width during construction (default 200)
 * - efSearch: search width during search (default 100)
 * - levelMult: probability multiplier for level generation (default 1/log(2) ≈ 1.44)
 */

import { v4 as uuidv4 } from 'uuid';
import { query, getDatabase } from '../utils/db.js';

export interface HNSWConfig {
  M: number;
  efConstruction: number;
  efSearch: number;
  levelMult: number;
  dimension: number;
  metric: 'cosine' | 'l2' | 'ip';
}

export interface HNSWNode {
  id: string;
  memoryId: string;
  vector: number[];
  level: number;
  labels: string[];
  createdAt: string;
}

export interface HNSWSearchResult {
  memoryId: string;
  score: number;
}

const DEFAULT_CONFIG: HNSWConfig = {
  M: 16,
  efConstruction: 200,
  efSearch: 100,
  levelMult: 1 / Math.log(2),
  dimension: 4096, // will be overridden when initHNSWIndex is called
  metric: 'cosine'
};

// In-memory HNSW structures (for active indexes)
const hnswIndexes = new Map<string, {
  config: HNSWConfig;
  nodes: Map<string, HNSWNode>;
  entryPoints: Map<number, string>; // level -> node id
  memoryIndex: Map<string, string>; // memoryId -> node id
}>();

/**
 * Initialize HNSW index in database
 */
export function initHNSWIndex(_indexName: string, config: Partial<HNSWConfig> = {}): HNSWConfig {
  const db = getDatabase();

  let dimension = config.dimension ?? DEFAULT_CONFIG.dimension;
  try {
    const { getCurrentProvider } = require('./embedding-provider.js');
    const provider = getCurrentProvider();
    if (provider) {
      dimension = provider.dimension;
    }
  } catch {
    // provider not ready yet, use configured or default
  }

  const fullConfig: HNSWConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    dimension,
  };
  
  db.run(`
    CREATE TABLE IF NOT EXISTS hnsw_nodes (
      id TEXT PRIMARY KEY,
      index_name TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      vector TEXT NOT NULL,
      level INTEGER NOT NULL,
      labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_hnsw_nodes_index ON hnsw_nodes(index_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hnsw_nodes_memory ON hnsw_nodes(index_name, memory_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_hnsw_nodes_level ON hnsw_nodes(index_name, level)`);
  
  return fullConfig;
}

/**
 * Create a new HNSW index in memory
 */
export function createHNSWIndex(indexName: string, config: Partial<HNSWConfig> = {}): HNSWConfig {
  let dimension = config.dimension ?? DEFAULT_CONFIG.dimension;
  try {
    const { getCurrentProvider } = require('./embedding-provider.js');
    const provider = getCurrentProvider();
    if (provider) {
      dimension = provider.dimension;
    }
  } catch {
    // provider not ready yet
  }

  const fullConfig: HNSWConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    dimension,
  };
  
  if (!hnswIndexes.has(indexName)) {
    hnswIndexes.set(indexName, {
      config: fullConfig,
      nodes: new Map(),
      entryPoints: new Map(),
      memoryIndex: new Map()
    });
  }
  
  return fullConfig;
}

/**
 * Get or create an HNSW index
 */
export function getHNSWIndex(indexName: string): HNSWConfig | null {
  if (hnswIndexes.has(indexName)) {
    return hnswIndexes.get(indexName)!.config;
  }
  
  // Try to load from database
  const rows = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM hnsw_nodes WHERE index_name = ? LIMIT 1`,
    [indexName]
  );
  
  if (rows.length > 0 && rows[0].count > 0) {
    // Index exists in DB but not in memory - needs rebuild
    return null;
  }
  
  return null;
}

/**
 * Calculate random level based on levelMult
 */
function calculateLevel(config: HNSWConfig): number {
  let level = 0;
  while (Math.random() < Math.exp(-level * config.levelMult) && level < Math.ceil(Math.log(config.dimension))) {
    level++;
  }
  return Math.max(0, level - 1);
}

/**
 * Calculate distance between two vectors
 */
function calculateDistance(a: number[], b: number[], metric: 'cosine' | 'l2' | 'ip'): number {
  if (metric === 'cosine') {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : 1 - dot / denom;
  } else if (metric === 'l2') {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  } else {
    // inner product (higher is more similar)
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return -dot; // negate so lower is better (like other metrics)
  }
}

/**
 * Search for nearest neighbors in a layer
 */
function searchLayerLayer(
  nodes: Map<string, HNSWNode>,
  queryVector: number[],
  ef: number,
  level: number,
  metric: 'cosine' | 'l2' | 'ip'
): Array<{ id: string; score: number }> {
  const visited = new Set<string>();
  const candidates: Array<{ id: string; score: number }> = [];
  const result: Array<{ id: string; score: number }> = [];
  
  // Initialize with entry point
  const entryId = Array.from(nodes.values()).find(n => n.level >= level)?.id;
  if (!entryId) return result;
  
  candidates.push({ id: entryId, score: calculateDistance(queryVector, nodes.get(entryId)!.vector, metric) });
  visited.add(entryId);
  
  while (candidates.length > 0) {
    // Sort by score (lowest first for distance)
    candidates.sort((a, b) => a.score - b.score);
    const current = candidates.shift()!;
    
    if (result.length === 0 || current.score < result[result.length - 1].score || result.length < ef) {
      result.push(current);
      
      // Search neighbors (simplified - in real HNSW this would use the graph structure)
      for (const [neighborId, neighbor] of nodes) {
        if (visited.has(neighborId) || neighbor.level < level) continue;
        visited.add(neighborId);
        
        const dist = calculateDistance(queryVector, neighbor.vector, metric);
        if (result.length < ef || dist < result[result.length - 1].score) {
          candidates.push({ id: neighborId, score: dist });
        }
      }
    }
  }
  
  return result.slice(0, ef);
}

/**
 * Insert a node into the HNSW index
 */
export function insertHNSWNode(
  indexName: string,
  memoryId: string,
  vector: number[],
  labels: string[] = []
): HNSWNode | null {
  const index = hnswIndexes.get(indexName);
  if (!index) return null;

  // Warn on dimension mismatch (index may have been built with different provider)
  if (vector.length !== index.config.dimension) {
    index.config.dimension = vector.length;
  }
  
  // Check if already exists
  if (index.memoryIndex.has(memoryId)) {
    return index.nodes.get(index.memoryIndex.get(memoryId)!) || null;
  }
  
  const nodeId = uuidv4();
  const level = calculateLevel(index.config);
  
  const node: HNSWNode = {
    id: nodeId,
    memoryId,
    vector,
    level,
    labels,
    createdAt: new Date().toISOString()
  };
  
  index.nodes.set(nodeId, node);
  index.memoryIndex.set(memoryId, nodeId);
  
  // Update entry points
  for (let l = level; l >= 0; l--) {
    if (!index.entryPoints.has(l) || level > (index.nodes.get(index.entryPoints.get(l)!)?.level || -1)) {
      index.entryPoints.set(l, nodeId);
    }
  }
  
  return node;
}

/**
 * Search for nearest neighbors
 */
export function searchHNSW(
  indexName: string,
  queryVector: number[],
  k: number = 10,
  efSearch?: number
): HNSWSearchResult[] {
  const index = hnswIndexes.get(indexName);
  if (!index) return [];
  
  const ef = efSearch || index.config.efSearch;
  
  // Start from top level entry point
  for (let level = Math.max(...Array.from(index.entryPoints.keys())); level >= 0; level--) {
    const entryId = index.entryPoints.get(level);
    if (!entryId) continue;
    
    searchLayerLayer(
      index.nodes,
      queryVector,
      ef,
      level,
      index.config.metric
    );
  }
  
  // Final search at level 0
  const finalResults = searchLayerLayer(
    index.nodes,
    queryVector,
    ef,
    0,
    index.config.metric
  );
  
  return finalResults.slice(0, k).map(r => ({
    memoryId: index.nodes.get(r.id)!.memoryId,
    score: 1 - r.score // Convert distance to similarity for cosine
  }));
}

/**
 * Remove a node from HNSW index
 */
export function removeHNSWNode(indexName: string, memoryId: string): boolean {
  const index = hnswIndexes.get(indexName);
  if (!index) return false;
  
  const nodeId = index.memoryIndex.get(memoryId);
  if (!nodeId) return false;
  
  index.nodes.delete(nodeId);
  index.memoryIndex.delete(memoryId);
  
  // Update entry points
  for (const [level, epId] of index.entryPoints) {
    if (epId === nodeId) {
      // Find new entry point at this level
      const newEp = Array.from(index.nodes.values()).find(n => n.level >= level);
      if (newEp) {
        index.entryPoints.set(level, newEp.id);
      } else {
        index.entryPoints.delete(level);
      }
    }
  }
  
  return true;
}

/**
 * Get statistics for an HNSW index
 */
export function getHNSWStats(indexName: string): {
  nodeCount: number;
  maxLevel: number;
  memorySize: number;
  config: HNSWConfig;
} | null {
  const index = hnswIndexes.get(indexName);
  if (!index) return null;
  
  let maxLevel = 0;
  let totalSize = 0;
  
  for (const node of index.nodes.values()) {
    if (node.level > maxLevel) maxLevel = node.level;
    totalSize += node.vector.length * 8; // 8 bytes per float64
  }
  
  return {
    nodeCount: index.nodes.size,
    maxLevel,
    memorySize: totalSize,
    config: index.config
  };
}

/**
 * Clear an HNSW index from memory
 */
export function clearHNSWIndex(indexName: string): void {
  hnswIndexes.delete(indexName);
}

/**
 * Sync HNSW index with database (load persisted nodes)
 */
export function syncHNSWFromDB(indexName: string, config: Partial<HNSWConfig> = {}): number {
  // Omit dimension so createHNSWIndex resolves it from the current provider
  createHNSWIndex(indexName, config);
  const index = hnswIndexes.get(indexName)!;
  
  const rows = query<{
    id: string;
    memory_id: string;
    vector: string;
    level: number;
    labels: string;
    created_at: string;
  }>(`SELECT * FROM hnsw_nodes WHERE index_name = ?`, [indexName]);
  
  for (const row of rows) {
    const node: HNSWNode = {
      id: row.id,
      memoryId: row.memory_id,
      vector: JSON.parse(row.vector),
      level: row.level,
      labels: JSON.parse(row.labels),
      createdAt: row.created_at
    };
    
    index.nodes.set(node.id, node);
    index.memoryIndex.set(node.memoryId, node.id);
    
    // Update entry points
    for (let l = node.level; l >= 0; l--) {
      if (!index.entryPoints.has(l) || node.level > (index.nodes.get(index.entryPoints.get(l)!)?.level || -1)) {
        index.entryPoints.set(l, node.id);
      }
    }
  }
  
  return rows.length;
}

/**
 * Persist HNSW nodes to database
 */
export function persistHNSWToDB(indexName: string): number {
  const index = hnswIndexes.get(indexName);
  if (!index) return 0;
  
  let count = 0;
  const db = getDatabase();
  
  for (const node of index.nodes.values()) {
    db.run(
      `INSERT OR REPLACE INTO hnsw_nodes (id, index_name, memory_id, vector, level, labels, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [node.id, indexName, node.memoryId, JSON.stringify(node.vector), node.level, JSON.stringify(node.labels), node.createdAt]
    );
    count++;
  }
  
  return count;
}
