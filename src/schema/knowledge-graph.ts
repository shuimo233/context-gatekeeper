/**
 * Knowledge Graph schema and operations
 * Manages entities, relations, and facts extracted from memories
 */

import { v4 as uuidv4 } from 'uuid';
import { query, run, getDatabase } from '../utils/db.js';
import { DatabaseError } from '../utils/errors.js';

// ============ Types ============

export interface KGEntity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  sourceMemoryId: string | null;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGRelation {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  properties: Record<string, unknown>;
  sourceMemoryId: string | null;
  confidence: number;
  bidirectional: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGFact {
  id: string;
  entityId: string;
  relationId: string | null;
  predicate: string;
  value: string;
  confidence: number;
  sourceMemoryId: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KGExtractionResult {
  entities: KGEntity[];
  relations: KGRelation[];
  facts: KGFact[];
}

// ============ Schema ============

export function initKnowledgeGraph(): void {
  const db = getDatabase();

  try {
    // Entities table
    db.run(`
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        source_memory_id TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_entities_source ON kg_entities(source_memory_id)`);

    // Relations table
    db.run(`
      CREATE TABLE IF NOT EXISTS kg_relations (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        source_memory_id TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        bidirectional INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_entity_id) REFERENCES kg_entities(id),
        FOREIGN KEY (target_entity_id) REFERENCES kg_entities(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_relations_source ON kg_relations(source_entity_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_relations_target ON kg_relations(target_entity_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_relations_type ON kg_relations(relation_type)`);

    // Facts table
    db.run(`
      CREATE TABLE IF NOT EXISTS kg_facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        relation_id TEXT,
        predicate TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        source_memory_id TEXT,
        valid_from TEXT,
        valid_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (entity_id) REFERENCES kg_entities(id),
        FOREIGN KEY (relation_id) REFERENCES kg_relations(id)
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_facts_entity ON kg_facts(entity_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_facts_predicate ON kg_facts(predicate)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_kg_facts_source ON kg_facts(source_memory_id)`);

  } catch (error) {
    throw new DatabaseError('Failed to initialize knowledge graph schema', error);
  }
}

// ============ Entity Operations ============

export function createEntity(input: {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
  sourceMemoryId?: string;
  confidence?: number;
}): KGEntity {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO kg_entities (id, name, type, properties, source_memory_id, confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.type,
        JSON.stringify(input.properties || {}),
        input.sourceMemoryId || null,
        input.confidence ?? 1.0,
        now,
        now
      ]
    );

    return getEntity(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create entity', error);
  }
}

export function getEntity(id: string): KGEntity | null {
  try {
    const rows = query<EntityRow>(`SELECT * FROM kg_entities WHERE id = ?`, [id]);
    return rows.length > 0 ? mapEntityRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get entity', error);
  }
}

export function findEntityByName(name: string, type?: string): KGEntity | null {
  try {
    let sql = `SELECT * FROM kg_entities WHERE name = ?`;
    const params: unknown[] = [name];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` LIMIT 1`;

    const rows = query<EntityRow>(sql, params);
    return rows.length > 0 ? mapEntityRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to find entity', error);
  }
}

export function getOrCreateEntity(input: {
  name: string;
  type: string;
  properties?: Record<string, unknown>;
  sourceMemoryId?: string;
  confidence?: number;
}): KGEntity {
  const existing = findEntityByName(input.name, input.type);
  if (existing) {
    return existing;
  }
  return createEntity(input);
}

export function updateEntity(id: string, updates: {
  name?: string;
  type?: string;
  properties?: Record<string, unknown>;
  confidence?: number;
}): KGEntity {
  const existing = getEntity(id);
  if (!existing) {
    throw new DatabaseError('Entity not found', new Error(id));
  }

  const now = new Date().toISOString();
  const updatesList: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  if (updates.name !== undefined) {
    updatesList.push('name = ?');
    params.push(updates.name);
  }
  if (updates.type !== undefined) {
    updatesList.push('type = ?');
    params.push(updates.type);
  }
  if (updates.properties !== undefined) {
    updatesList.push('properties = ?');
    params.push(JSON.stringify(updates.properties));
  }
  if (updates.confidence !== undefined) {
    updatesList.push('confidence = ?');
    params.push(updates.confidence);
  }

  params.push(id);
  run(`UPDATE kg_entities SET ${updatesList.join(', ')} WHERE id = ?`, params);

  return getEntity(id)!;
}

export function listEntities(options: {
  type?: string;
  limit?: number;
  offset?: number;
} = {}): KGEntity[] {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const sql = `SELECT * FROM kg_entities${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(options.limit ?? 100);
    params.push(options.offset ?? 0);

    const rows = query<EntityRow>(sql, params);
    return rows.map(mapEntityRow);
  } catch (error) {
    throw new DatabaseError('Failed to list entities', error);
  }
}

export function deleteEntity(id: string): void {
  // Delete related facts and relations first
  run(`DELETE FROM kg_facts WHERE entity_id = ? OR entity_id IN (SELECT entity_id FROM kg_relations WHERE source_entity_id = ? OR target_entity_id = ?)`, [id, id, id]);
  run(`DELETE FROM kg_relations WHERE source_entity_id = ? OR target_entity_id = ?`, [id, id]);
  run(`DELETE FROM kg_entities WHERE id = ?`, [id]);
}

// ============ Relation Operations ============

export function createRelation(input: {
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  properties?: Record<string, unknown>;
  sourceMemoryId?: string;
  confidence?: number;
  bidirectional?: boolean;
}): KGRelation {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO kg_relations (id, source_entity_id, target_entity_id, relation_type, properties, source_memory_id, confidence, bidirectional, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.sourceEntityId,
        input.targetEntityId,
        input.relationType,
        JSON.stringify(input.properties || {}),
        input.sourceMemoryId || null,
        input.confidence ?? 1.0,
        input.bidirectional ? 1 : 0,
        now,
        now
      ]
    );

    return getRelation(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create relation', error);
  }
}

export function getRelation(id: string): KGRelation | null {
  try {
    const rows = query<RelationRow>(`SELECT * FROM kg_relations WHERE id = ?`, [id]);
    return rows.length > 0 ? mapRelationRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get relation', error);
  }
}

export function findRelation(sourceEntityId: string, targetEntityId: string, relationType: string): KGRelation | null {
  try {
    const rows = query<RelationRow>(
      `SELECT * FROM kg_relations WHERE source_entity_id = ? AND target_entity_id = ? AND relation_type = ? LIMIT 1`,
      [sourceEntityId, targetEntityId, relationType]
    );
    return rows.length > 0 ? mapRelationRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to find relation', error);
  }
}

export function getRelationsByEntity(entityId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): KGRelation[] {
  try {
    let sql = `SELECT * FROM kg_relations WHERE `;

    if (direction === 'outgoing') {
      sql += `source_entity_id = ?`;
    } else if (direction === 'incoming') {
      sql += `target_entity_id = ?`;
    } else {
      sql += `(source_entity_id = ? OR target_entity_id = ?)`;
    }

    const rows = query<RelationRow>(sql, direction === 'both' ? [entityId, entityId] : [entityId]);
    return rows.map(mapRelationRow);
  } catch (error) {
    throw new DatabaseError('Failed to get relations by entity', error);
  }
}

export function deleteRelation(id: string): void {
  // Delete related facts first
  run(`DELETE FROM kg_facts WHERE relation_id = ?`, [id]);
  run(`DELETE FROM kg_relations WHERE id = ?`, [id]);
}

// ============ Fact Operations ============

export function createFact(input: {
  entityId: string;
  relationId?: string;
  predicate: string;
  value: string;
  sourceMemoryId?: string;
  confidence?: number;
  validFrom?: Date;
  validTo?: Date;
}): KGFact {
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    run(
      `INSERT INTO kg_facts (id, entity_id, relation_id, predicate, value, source_memory_id, confidence, valid_from, valid_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.entityId,
        input.relationId || null,
        input.predicate,
        input.value,
        input.sourceMemoryId || null,
        input.confidence ?? 1.0,
        input.validFrom?.toISOString() || null,
        input.validTo?.toISOString() || null,
        now,
        now
      ]
    );

    return getFact(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create fact', error);
  }
}

export function getFact(id: string): KGFact | null {
  try {
    const rows = query<FactRow>(`SELECT * FROM kg_facts WHERE id = ?`, [id]);
    return rows.length > 0 ? mapFactRow(rows[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get fact', error);
  }
}

export function getFactsByEntity(entityId: string): KGFact[] {
  try {
    const rows = query<FactRow>(`SELECT * FROM kg_facts WHERE entity_id = ? ORDER BY created_at DESC`, [entityId]);
    return rows.map(mapFactRow);
  } catch (error) {
    throw new DatabaseError('Failed to get facts by entity', error);
  }
}

export function deleteFact(id: string): void {
  run(`DELETE FROM kg_facts WHERE id = ?`, [id]);
}

// ============ Knowledge Graph Statistics ============

export interface KGStats {
  entityCount: number;
  relationCount: number;
  factCount: number;
  entityTypes: Record<string, number>;
  relationTypes: Record<string, number>;
}

export function getKGStats(): KGStats {
  try {
    const entityCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM kg_entities`)[0]?.count ?? 0;
    const relationCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM kg_relations`)[0]?.count ?? 0;
    const factCount = query<{ count: number }>(`SELECT COUNT(*) as count FROM kg_facts`)[0]?.count ?? 0;

    const entityTypeRows = query<{ type: string; count: number }>(`SELECT type, COUNT(*) as count FROM kg_entities GROUP BY type`);
    const relationTypeRows = query<{ relation_type: string; count: number }>(`SELECT relation_type, COUNT(*) as count FROM kg_relations GROUP BY relation_type`);

    const entityTypes: Record<string, number> = {};
    for (const row of entityTypeRows) {
      entityTypes[row.type] = row.count;
    }

    const relationTypes: Record<string, number> = {};
    for (const row of relationTypeRows) {
      relationTypes[row.relation_type] = row.count;
    }

    return {
      entityCount,
      relationCount,
      factCount,
      entityTypes,
      relationTypes
    };
  } catch (error) {
    throw new DatabaseError('Failed to get KG stats', error);
  }
}

// ============ Helper Functions ============

interface EntityRow {
  id: string;
  name: string;
  type: string;
  properties: string;
  source_memory_id: string | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  properties: string;
  source_memory_id: string | null;
  confidence: number;
  bidirectional: number;
  created_at: string;
  updated_at: string;
}

interface FactRow {
  id: string;
  entity_id: string;
  relation_id: string | null;
  predicate: string;
  value: string;
  confidence: number;
  source_memory_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string;
  updated_at: string;
}

function mapEntityRow(row: EntityRow): KGEntity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    properties: safeParseJson(row.properties),
    sourceMemoryId: row.source_memory_id,
    confidence: row.confidence,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapRelationRow(row: RelationRow): KGRelation {
  return {
    id: row.id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type,
    properties: safeParseJson(row.properties),
    sourceMemoryId: row.source_memory_id,
    confidence: row.confidence,
    bidirectional: row.bidirectional === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapFactRow(row: FactRow): KGFact {
  return {
    id: row.id,
    entityId: row.entity_id,
    relationId: row.relation_id,
    predicate: row.predicate,
    value: row.value,
    confidence: row.confidence,
    sourceMemoryId: row.source_memory_id,
    validFrom: row.valid_from ? new Date(row.valid_from) : null,
    validTo: row.valid_to ? new Date(row.valid_to) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}
