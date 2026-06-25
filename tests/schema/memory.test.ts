import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemory,
  getMemory,
  listMemories,
  deleteMemory,
  computeContentHash,
  findDuplicateByHash,
  storeEmbedding,
  getEmbedding,
  cleanupExpiredMemories
} from '../../src/schema/memory.js';

describe('Memory Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createMemory', () => {
    it('should create a memory', () => {
      const memory = createMemory({ content: 'Test memory', priority: 'fact' });
      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory');
    });

    it('should support project tags', () => {
      const memory = createMemory({ content: 'Tagged', priority: 'fact', projectTags: ['alpha'] });
      expect(memory.projectTags).toEqual(['alpha']);
    });

    it('should support anchored flag', () => {
      const memory = createMemory({ content: 'Anchored', priority: 'constraint', anchored: true });
      expect(memory.anchored).toBe(true);
    });
  });

  describe('getMemory', () => {
    it('should retrieve existing memory', () => {
      const created = createMemory({ content: 'Find me', priority: 'fact' });
      const found = getMemory(created.id);
      expect(found?.content).toBe('Find me');
    });

    it('should return null for missing id', () => {
      expect(getMemory('missing')).toBeNull();
    });
  });

  describe('listMemories', () => {
    it('should list memories', () => {
      createMemory({ content: 'A', priority: 'fact' });
      createMemory({ content: 'B', priority: 'fact' });
      const memories = listMemories();
      expect(memories.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteMemory', () => {
    it('should soft delete memory', () => {
      const memory = createMemory({ content: 'Delete', priority: 'fact' });
      deleteMemory(memory.id);
      expect(getMemory(memory.id)).toBeNull();
    });
  });

  describe('computeContentHash', () => {
    it('should produce consistent hashes', () => {
      const hash1 = computeContentHash('test content');
      const hash2 = computeContentHash('test content');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = computeContentHash('content a');
      const hash2 = computeContentHash('content b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('findDuplicateByHash', () => {
    it('should find existing memory by hash', () => {
      const memory = createMemory({ content: 'Unique content 123', priority: 'fact' });
      const hash = computeContentHash('Unique content 123');
      storeEmbedding(memory.id, memory.content, [0.1, 0.2, 0.3]);
      const found = findDuplicateByHash(hash);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(memory.id);
    });

    it('should return null for non-existent hash', () => {
      const found = findDuplicateByHash('nonexistenthash');
      expect(found).toBeNull();
    });
  });

  describe('embeddings', () => {
    it('should store and retrieve embedding', () => {
      const memory = createMemory({ content: 'Test embedding', priority: 'fact' });
      const embedding = [0.1, 0.2, 0.3];
      storeEmbedding(memory.id, memory.content, embedding);
      const retrieved = getEmbedding(memory.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.embedding).toEqual(embedding);
    });
  });

  describe('cleanupExpiredMemories', () => {
    it('should clean up expired memories', () => {
      const expiredMemory = createMemory({
        content: 'Expired',
        priority: 'fact',
        expiresAt: new Date(Date.now() - 1000),
      });
      const count = cleanupExpiredMemories();
      expect(count).toBeGreaterThan(0);
      expect(getMemory(expiredMemory.id)).toBeNull();
    });
  });
});
