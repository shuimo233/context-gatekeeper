/**
 * Triple Extraction Pipeline
 * Extracts knowledge graph triples (entity-relation-entity) from memories and conversations
 */

import { getEntity, createEntity, createRelation, createFact, KGExtractionResult } from '../schema/knowledge-graph.js';
import type { Memory } from '../models/types.js';

// ============ Extraction Patterns ============

interface ExtractionPattern {
  pattern: RegExp;
  entityType: string;
  extractor: (match: RegExpMatchArray) => { name: string; properties?: Record<string, unknown> };
}

const ENTITY_PATTERNS: ExtractionPattern[] = [
  // Project names: "project X", "using project Y"
  {
    pattern: /\b(?:project|app|tool|framework|library|package)\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    entityType: 'project',
    extractor: (m) => ({ name: m[1], properties: { context: 'mentioned' } })
  },
  // Framework names: "React", "Vue", "Angular"
  {
    pattern: /\b(React|Vue|Angular|Svelte|Next\.?js|Nuxt\.?js|Laravel|Django|Flask|Rails|Spring)\b/gi,
    entityType: 'framework',
    extractor: (m) => ({ name: m[1] })
  },
  // Language names
  {
    pattern: /\b(JavaScript|TypeScript|Python|Java|Go|Rust|C\+\+|Ruby|PHP|Swift|Kotlin)\b/gi,
    entityType: 'language',
    extractor: (m) => ({ name: m[1] })
  },
  // Database names
  {
    pattern: /\b(PostgreSQL|MySQL|SQLite|MongoDB|Redis|Elasticsearch|Neo4j|Pinecone|Weaviate|Chroma)\b/gi,
    entityType: 'database',
    extractor: (m) => ({ name: m[1] })
  },
  // Cloud services
  {
    pattern: /\b(AWS|Azure|GCP|AWS\s+S3|AWS\s+Lambda|Azure\s+Functions|Google\s+Cloud)\b/gi,
    entityType: 'cloud_service',
    extractor: (m) => ({ name: m[1] })
  },
  // API names
  {
    pattern: /\b(OpenAI|Anthropic|Hugging\s+Face|Replicate|Cohere)\b/gi,
    entityType: 'api_service',
    extractor: (m) => ({ name: m[1] })
  },
  // User preferences (sentences with preference indicators)
  {
    pattern: /(?:I\s+prefer|I\s+like|I\s+wish|I\s+hate|I\s+always\s+use|I\s+never\s+use)\s+([^.]+)/gi,
    entityType: 'preference',
    extractor: (m) => ({ name: m[1].trim(), properties: { type: 'user_preference' } })
  },
  // Requirement sentences
  {
    pattern: /(?:must|should|need to|has to|requires|ensure)\s+([^.]+)/gi,
    entityType: 'requirement',
    extractor: (m) => ({ name: m[1].trim(), properties: { type: 'constraint' } })
  },
  // Decision sentences
  {
    pattern: /(?:decided|chose|selected|picked|going with|will use)\s+([^.]+)/gi,
    entityType: 'decision',
    extractor: (m) => ({ name: m[1].trim(), properties: { type: 'decision' } })
  },
];

interface RelationPattern {
  pattern: RegExp;
  relationType: string;
  extractor: (match: RegExpMatchArray) => { source: string; target: string; properties?: Record<string, unknown> };
  bidirectional?: boolean;
}

const RELATION_PATTERNS: RelationPattern[] = [
  // uses/uses technology
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+(?:uses|using|uses\s+the)\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'uses',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // depends on
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+depends\s+on\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'depends_on',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // built with
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+built\s+with\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'built_with',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // stored in
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+(?:stored|persisted|saved)\s+in\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'stored_in',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // hosted on
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+hosted\s+(?:on|in)\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'hosted_on',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // implements
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+implements\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'implements',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
  // follows
  {
    pattern: /\b([A-Z][a-zA-Z0-9_-]+)\s+follows?\s+([A-Z][a-zA-Z0-9_-]+)/gi,
    relationType: 'follows',
    extractor: (m) => ({ source: m[1], target: m[2] })
  },
];

// ============ Triple Extractor ============

export interface ExtractionConfig {
  minConfidence?: number;
  entityTypes?: string[];
  includeFacts?: boolean;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  minConfidence: 0.5,
  includeFacts: true
};

/**
 * Extract knowledge graph triples from a memory
 */
export function extractTriplesFromMemory(memory: Memory, config: ExtractionConfig = {}): KGExtractionResult {
  const { minConfidence = 0.5, includeFacts = true } = { ...DEFAULT_CONFIG, ...config };
  const content = memory.content;
  const sourceMemoryId = memory.id;

  const entities: KGExtractionResult['entities'] = [];
  const relations: KGExtractionResult['relations'] = [];
  const facts: KGExtractionResult['facts'] = [];
  const seenEntities = new Map<string, boolean>();
  const seenRelations = new Map<string, boolean>();

  // Extract entities
  for (const pattern of ENTITY_PATTERNS) {
    if (config.entityTypes && !config.entityTypes.includes(pattern.entityType)) {
      continue;
    }

    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
    
    while ((match = regex.exec(content)) !== null) {
      const extracted = pattern.extractor(match);
      const entityKey = `${extracted.name.toLowerCase()}:${pattern.entityType}`;

      if (!seenEntities.has(entityKey)) {
        seenEntities.set(entityKey, true);
        
        const entity = createEntity({
          name: extracted.name,
          type: pattern.entityType,
          properties: extracted.properties,
          sourceMemoryId,
          confidence: minConfidence + 0.1
        });
        entities.push(entity);

        // Create facts for entity properties
        if (includeFacts && extracted.properties) {
          for (const [predicate, value] of Object.entries(extracted.properties)) {
            facts.push(createFact({
              entityId: entity.id,
              predicate,
              value: String(value),
              sourceMemoryId,
              confidence: minConfidence + 0.1
            }));
          }
        }
      }
    }
  }

  // Extract relations
  for (const pattern of RELATION_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);

    while ((match = regex.exec(content)) !== null) {
      const extracted = pattern.extractor(match);
      const sourceEntity = findOrCreateEntity(extracted.source, 'entity', entities);
      const targetEntity = findOrCreateEntity(extracted.target, 'entity', entities);
      const relationKey = `${sourceEntity.id}:${pattern.relationType}:${targetEntity.id}`;

      if (!seenRelations.has(relationKey)) {
        seenRelations.set(relationKey, true);

        // Create source entity if doesn't exist
        let sourceKGEntity = getEntity(sourceEntity.id);
        if (!sourceKGEntity) {
          sourceKGEntity = createEntity({
            name: extracted.source,
            type: 'entity',
            sourceMemoryId,
            confidence: minConfidence
          });
        }

        // Create target entity if doesn't exist
        let targetKGEntity = getEntity(targetEntity.id);
        if (!targetKGEntity) {
          targetKGEntity = createEntity({
            name: extracted.target,
            type: 'entity',
            sourceMemoryId,
            confidence: minConfidence
          });
        }

        const relation = createRelation({
          sourceEntityId: sourceKGEntity.id,
          targetEntityId: targetKGEntity.id,
          relationType: pattern.relationType,
          properties: extracted.properties,
          sourceMemoryId,
          confidence: minConfidence + 0.1,
          bidirectional: pattern.bidirectional
        });
        relations.push(relation);
      }
    }
  }

  return { entities, relations, facts };
}

/**
 * Extract triples from multiple memories
 */
export function extractTriplesFromMemories(memories: Memory[], config: ExtractionConfig = {}): KGExtractionResult {
  const result: KGExtractionResult = {
    entities: [],
    relations: [],
    facts: []
  };

  for (const memory of memories) {
    const extracted = extractTriplesFromMemory(memory, config);
    result.entities.push(...extracted.entities);
    result.relations.push(...extracted.relations);
    result.facts.push(...extracted.facts);
  }

  // Deduplicate
  const seenEntityIds = new Set<string>();
  result.entities = result.entities.filter(e => {
    if (seenEntityIds.has(e.id)) return false;
    seenEntityIds.add(e.id);
    return true;
  });

  const seenRelationIds = new Set<string>();
  result.relations = result.relations.filter(r => {
    if (seenRelationIds.has(r.id)) return false;
    seenRelationIds.add(r.id);
    return true;
  });

  const seenFactIds = new Set<string>();
  result.facts = result.facts.filter(f => {
    if (seenFactIds.has(f.id)) return false;
    seenFactIds.add(f.id);
    return true;
  });

  return result;
}

/**
 * Extract triples from conversation turns
 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function extractTriplesFromConversation(
  turns: ConversationTurn[],
  config: ExtractionConfig = {}
): KGExtractionResult {
  // Only process user turns for constraints/preferences
  const userTurns = turns.filter(t => t.role === 'user');
  const content = userTurns.map(t => t.content).join(' ');

  // Create a synthetic memory-like object
  const syntheticMemory: Memory = {
    id: `conv-${Date.now()}`,
    userId: 'default',
    agentId: 'default',
    projectId: 'default',
    content,
    priority: 'fact',
    projectTags: [],
    anchored: false,
    accessCount: 0,
    version: 1,
    updatedBy: null,
    parentId: null,
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    deleted: false
  };

  return extractTriplesFromMemory(syntheticMemory, config);
}

// ============ Helper Functions ============

interface TempEntity {
  id: string;
  name: string;
  type: string;
}

function findOrCreateEntity(name: string, type: string, extractedEntities: TempEntity[]): TempEntity {
  const existing = extractedEntities.find(e => e.name.toLowerCase() === name.toLowerCase() && e.type === type);
  if (existing) {
    return existing;
  }

  // Create a temporary entity
  const tempEntity: TempEntity = {
    id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    type
  };
  extractedEntities.push(tempEntity);
  return tempEntity;
}

/**
 * Get context for a memory from the knowledge graph
 */
export function getMemoryContext(_memoryId: string): {
  relatedEntities: ReturnType<typeof getEntity>[];
  relatedRelations: Awaited<ReturnType<typeof import('../schema/knowledge-graph.js').getRelationsByEntity>>;
} {
  // This would integrate with the KG schema once memory-to-entity mappings exist
  // For now, return empty context
  return {
    relatedEntities: [],
    relatedRelations: []
  };
}
