import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { rerankMemories, createReranker, RerankConfig } from '../../src/services/reranker.js';
import { Memory } from '../../src/models/types.js';

describe('Reranker Service', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('rerankMemories', () => {
    it('should rerank memories by relevance', () => {
      const candidates: Memory[] = [
        {
          id: '1', content: 'TypeScript is a typed language', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 5, version: 1,
          updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
          expiresAt: null, deleted: false,
        },
        {
          id: '2', content: 'Random fact about something', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 1, version: 1,
          updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
          expiresAt: null, deleted: false,
        },
      ];

      const reranked = rerankMemories('TypeScript', candidates);
      expect(Array.isArray(reranked)).toBe(true);
      expect(reranked.length).toBeGreaterThan(0);
      expect(reranked[0].memory.id).toBe('1');
    });

    it('should return all provided candidates without a search limit', () => {
      const candidates: Memory[] = Array.from({ length: 20 }, (_, i) => ({
        id: String(i), content: `Content ${i}`, priority: 'fact' as const,
        projectTags: [], anchored: false, accessCount: i, version: 1,
        updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
        expiresAt: null, deleted: false,
      }));

      const reranked = rerankMemories('content', candidates);
      expect(reranked).toHaveLength(20);
    });

    it('should boost recent memories', () => {
      const now = Date.now();
      const candidates: Memory[] = [
        {
          id: '1', content: 'keyword keyword keyword', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 1, version: 1,
          updatedBy: null, createdAt: new Date(now - 86400000 * 30), updatedAt: new Date(now - 86400000 * 30),
          expiresAt: null, deleted: false,
        },
        {
          id: '2', content: 'keyword keyword keyword', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 1, version: 1,
          updatedBy: null, createdAt: new Date(now - 86400000), updatedAt: new Date(now - 86400000),
          expiresAt: null, deleted: false,
        },
      ];

      const reranked = rerankMemories('keyword', candidates);
      expect(Array.isArray(reranked)).toBe(true);
      expect(reranked.length).toBeGreaterThan(0);
      expect(reranked[0].memory.id).toBe('2');
    });

    it('should boost accessed memories', () => {
      const candidates: Memory[] = [
        {
          id: '1', content: 'same content same content', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 1, version: 1,
          updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
          expiresAt: null, deleted: false,
        },
        {
          id: '2', content: 'same content same content', priority: 'fact',
          projectTags: [], anchored: false, accessCount: 100, version: 1,
          updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
          expiresAt: null, deleted: false,
        },
      ];

      const reranked = rerankMemories('content', candidates);
      expect(Array.isArray(reranked)).toBe(true);
      expect(reranked.length).toBeGreaterThan(0);
      expect(reranked[0].memory.id).toBe('2');
    });
  });

  describe('createReranker', () => {
    it('should create reranker with custom config', () => {
      const config: Partial<RerankConfig> = {
        rerankWeight: {
          semantic: 0.6,
          keyword: 0.3,
          recency: 0.1,
          importance: 0.0,
        },
        finalLimit: 20,
      };

      const reranker = createReranker(config);
      expect(reranker).toBeDefined();
    });

    it('should use default weights', () => {
      const reranker = createReranker({});
      expect(reranker).toBeDefined();
    });
  });
});
