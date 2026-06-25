import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { getMemoryService, SearchMode } from '../../src/services/memory.js';

describe('MemoryService', () => {
  let memoryService: ReturnType<typeof getMemoryService>;

  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
    memoryService = getMemoryService();
  });

  describe('storeMemory', () => {
    it('should store a new memory', () => {
      const memory = memoryService.storeMemory({
        content: 'Test memory',
        priority: 'fact'
      });

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory');
    });

    it('should store memory with project tags', () => {
      const memory = memoryService.storeMemory({
        content: 'Tagged memory',
        priority: 'fact',
        projectTags: ['tag1', 'tag2']
      });

      expect(memory.projectTags).toEqual(['tag1', 'tag2']);
    });

    it('should store memory with expiration', () => {
      const expiresAt = new Date(Date.now() + 3600000);
      const memory = memoryService.storeMemory({
        content: 'Expiring memory',
        priority: 'fact',
        expiresAt
      });

      expect(memory.expiresAt).toBeInstanceOf(Date);
    });

    it('should deduplicate by content hash', () => {
      const first = memoryService.storeMemory({
        content: 'Duplicate content',
        priority: 'fact'
      });

      const second = memoryService.storeMemory({
        content: 'Duplicate content',
        priority: 'fact'
      });

      expect(first.id).toBe(second.id);
    });
  });

  describe('recallMemories', () => {
    it('should recall memories with keyword search', () => {
      memoryService.storeMemory({ content: 'Python is great', priority: 'fact' });
      memoryService.storeMemory({ content: 'JavaScript too', priority: 'fact' });

      const results = memoryService.recallMemories({ query: 'Python' });
      expect(results.some(m => m.content.includes('Python'))).toBe(true);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        memoryService.storeMemory({ content: `Memory ${i}`, priority: 'fact' });
      }

      const results = memoryService.recallMemories({ query: 'Memory', limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by project tags', () => {
      memoryService.storeMemory({ content: 'Tag filtered', priority: 'fact', projectTags: ['special'] });
      memoryService.storeMemory({ content: 'Not filtered', priority: 'fact' });

      const results = memoryService.recallMemories({ query: 'filtered', projectTags: ['special'] });
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Tag filtered');
    });

    it('should detect search mode for short queries', () => {
      // Short query should use keyword search
      const results = memoryService.recallMemories({ query: 'test' });
      // Just verify it doesn't throw
      expect(Array.isArray(results)).toBe(true);
    });

    it('should detect search mode for natural language queries', () => {
      // Natural language query should use semantic search
      const results = memoryService.recallMemories({ query: 'how does machine learning work' });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getMemory', () => {
    it('should get an existing memory', () => {
      const created = memoryService.storeMemory({ content: 'Get test', priority: 'fact' });
      const retrieved = memoryService.getMemory(created.id);
      expect(retrieved?.content).toBe('Get test');
    });

    it('should return null for non-existent memory', () => {
      const result = memoryService.getMemory('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('anchorMemory', () => {
    it('should anchor an existing memory', () => {
      const created = memoryService.storeMemory({ content: 'Will anchor', priority: 'fact' });
      const anchored = memoryService.anchorMemory(created.id);
      expect(anchored.anchored).toBe(true);
    });
  });

  describe('removeMemory', () => {
    it('should remove a memory', () => {
      const created = memoryService.storeMemory({ content: 'Will remove', priority: 'fact' });
      memoryService.removeMemory(created.id);
      const result = memoryService.getMemory(created.id);
      expect(result).toBeNull();
    });
  });

  describe('listAllMemories', () => {
    it('should list all memories', () => {
      memoryService.storeMemory({ content: 'List 1', priority: 'fact' });
      memoryService.storeMemory({ content: 'List 2', priority: 'fact' });

      const all = memoryService.listAllMemories();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by project tags', () => {
      memoryService.storeMemory({ content: 'Listed', priority: 'fact', projectTags: ['filterable'] });
      memoryService.storeMemory({ content: 'Not listed', priority: 'fact' });

      const filtered = memoryService.listAllMemories(['filterable']);
      expect(filtered.length).toBe(1);
    });
  });

  describe('getHighPriorityMemories', () => {
    it('should return only high priority memories', () => {
      memoryService.storeMemory({ content: 'Constraint', priority: 'constraint' });
      memoryService.storeMemory({ content: 'Fact', priority: 'fact' });

      const highPriority = memoryService.getHighPriorityMemories();
      expect(highPriority.every(m => m.priority === 'constraint' || m.priority === 'anchored')).toBe(true);
    });
  });

  describe('isMemoryHighPriority', () => {
    it('should return true for anchored', () => {
      const memory = memoryService.storeMemory({ content: 'High', priority: 'anchored' });
      expect(memoryService.isMemoryHighPriority(memory)).toBe(true);
    });

    it('should return true for constraint', () => {
      const memory = memoryService.storeMemory({ content: 'High', priority: 'constraint' });
      expect(memoryService.isMemoryHighPriority(memory)).toBe(true);
    });

    it('should return false for fact', () => {
      const memory = memoryService.storeMemory({ content: 'Low', priority: 'fact' });
      expect(memoryService.isMemoryHighPriority(memory)).toBe(false);
    });

    it('should return false for null', () => {
      expect(memoryService.isMemoryHighPriority(null)).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should cleanup expired memories', () => {
      const expired = new Date(Date.now() - 1000);
      memoryService.storeMemory({
        content: 'Expired',
        priority: 'fact',
        expiresAt: expired
      });

      const count = memoryService.cleanupExpired();
      expect(count).toBe(1);
    });
  });

  describe('search index', () => {
    it('should report search index availability', () => {
      const available = memoryService.isSearchIndexAvailable();
      // May or may not be available depending on FTS5 support
      expect(typeof available).toBe('boolean');
    });
  });

  describe('isolation context', () => {
    it('should have default isolation context', () => {
      // Default isolation should be 'default'
      const memory = memoryService.storeMemory({ content: 'Isolation test', priority: 'fact' });
      expect(memory.userId).toBe('default');
      expect(memory.agentId).toBe('default');
      expect(memory.projectId).toBe('default');
    });
  });
});
