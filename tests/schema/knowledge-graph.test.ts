import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createEntity,
  getEntity,
  createRelation,
  getRelationsByEntity,
  createFact,
  getFactsByEntity,
  getEntitiesByType,
  getRelatedEntities,
  extractTriplesFromText,
  getKnowledgeGraphStats,
} from '../../src/schema/knowledge-graph.js';

describe('KnowledgeGraph Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createEntity', () => {
    it('should create an entity', () => {
      const entity = createEntity({
        name: 'TypeScript',
        type: 'technology',
        properties: { founded: '2012', creator: 'Microsoft' },
      });

      expect(entity.id).toBeDefined();
      expect(entity.name).toBe('TypeScript');
      expect(entity.type).toBe('technology');
      expect(entity.properties.founded).toBe('2012');
    });

    it('should create entities of different types', () => {
      const types = ['person', 'technology', 'concept', 'project', 'organization'];
      for (const type of types) {
        const entity = createEntity({ name: `Entity-${type}`, type });
        expect(entity.type).toBe(type);
      }
    });
  });

  describe('getEntity', () => {
    it('should retrieve existing entity', () => {
      const created = createEntity({ name: 'FindMe', type: 'concept' });
      const found = getEntity(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('FindMe');
    });

    it('should return null for non-existent', () => {
      const found = getEntity('kg-nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('createRelation', () => {
    it('should create a relation between entities', () => {
      const e1 = createEntity({ name: 'Alice', type: 'person' });
      const e2 = createEntity({ name: 'Bob', type: 'person' });

      const relation = createRelation({
        sourceEntityId: e1.id,
        targetEntityId: e2.id,
        relationType: 'knows',
      });

      expect(relation.id).toBeDefined();
      expect(relation.relationType).toBe('knows');
    });
  });

  describe('getRelationsByEntity', () => {
    it('should get outgoing relations', () => {
      const e1 = createEntity({ name: 'Source', type: 'concept' });
      const e2 = createEntity({ name: 'Target', type: 'concept' });
      createRelation({ sourceEntityId: e1.id, targetEntityId: e2.id, relationType: 'relates_to' });

      const relations = getRelationsByEntity(e1.id, 'outgoing');
      expect(relations.length).toBeGreaterThanOrEqual(1);
    });

    it('should get incoming relations', () => {
      const e1 = createEntity({ name: 'Source', type: 'concept' });
      const e2 = createEntity({ name: 'Target', type: 'concept' });
      createRelation({ sourceEntityId: e1.id, targetEntityId: e2.id, relationType: 'depends_on' });

      const relations = getRelationsByEntity(e2.id, 'incoming');
      expect(relations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('createFact', () => {
    it('should create a fact from a triple', () => {
      const subject = createEntity({ name: 'Memory', type: 'concept' });
      const fact = createFact({
        entityId: subject.id,
        predicate: 'is_a',
        value: 'cognitive_system',
        confidence: 0.95,
        sourceMemoryId: 'test-memory-id',
      });

      expect(fact.id).toBeDefined();
      expect(fact.predicate).toBe('is_a');
      expect(fact.value).toBe('cognitive_system');
      expect(fact.confidence).toBe(0.95);
    });
  });

  describe('getFactsByEntity', () => {
    it('should get facts by subject or object', () => {
      const subject = createEntity({ name: 'Python', type: 'technology' });
      createFact({
        entityId: subject.id,
        predicate: 'is',
        value: 'programming_language',
        confidence: 0.9,
      });

      const facts = getFactsByEntity(subject.id);
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts[0].entityId).toBe(subject.id);
    });
  });

  describe('getEntitiesByType', () => {
    it('should filter entities by type', () => {
      createEntity({ name: 'JavaScript', type: 'technology' });
      createEntity({ name: 'TypeScript', type: 'technology' });
      createEntity({ name: 'Alice', type: 'person' });

      const techEntities = getEntitiesByType('technology');
      expect(techEntities.length).toBeGreaterThanOrEqual(2);
      expect(techEntities.every(e => e.type === 'technology')).toBe(true);
    });
  });

  describe('getRelatedEntities', () => {
    it('should find entities related through graph traversal', () => {
      const e1 = createEntity({ name: 'A', type: 'concept' });
      const e2 = createEntity({ name: 'B', type: 'concept' });
      const e3 = createEntity({ name: 'C', type: 'concept' });

      createRelation({ sourceEntityId: e1.id, targetEntityId: e2.id, relationType: 'relates' });
      createRelation({ sourceEntityId: e2.id, targetEntityId: e3.id, relationType: 'relates' });

      const related = getRelatedEntities(e1.id, 2);
      expect(related.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractTriplesFromText', () => {
    it('should extract subject-predicate-object triples', () => {
      const triples = extractTriplesFromText('TypeScript is a superset of JavaScript');
      expect(triples.length).toBeGreaterThanOrEqual(1);
      expect(triples[0].subject).toBeTruthy();
      expect(triples[0].predicate).toBeTruthy();
      expect(triples[0].object).toBeTruthy();
    });

    it('should handle empty text', () => {
      const triples = extractTriplesFromText('');
      expect(triples.length).toBe(0);
    });
  });

  describe('getKnowledgeGraphStats', () => {
    it('should return stats for empty graph', () => {
      const stats = getKnowledgeGraphStats();
      expect(stats.totalEntities).toBe(0);
      expect(stats.totalRelations).toBe(0);
      expect(stats.totalFacts).toBe(0);
    });

    it('should count entities and relations', () => {
      const e1 = createEntity({ name: 'Entity1', type: 'concept' });
      const e2 = createEntity({ name: 'Entity2', type: 'concept' });
      createRelation({ sourceEntityId: e1.id, targetEntityId: e2.id, relationType: 'test' });
      createFact({ entityId: e1.id, predicate: 'is', value: 'Demo', confidence: 0.5 });

      const stats = getKnowledgeGraphStats();
      expect(stats.totalEntities).toBeGreaterThanOrEqual(2);
      expect(stats.totalRelations).toBeGreaterThanOrEqual(1);
      expect(stats.totalFacts).toBeGreaterThanOrEqual(1);
    });
  });
});
