import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabase, initDatabase, getDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { MemoryService, getMemoryService, resetMemoryService } from '../../src/services/memory.js';
import { createMemory } from '../../src/schema/memory.js';

describe('MemoryService', () => {
  let service: MemoryService;

  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
    resetMemoryService();
    service = getMemoryService();
  });

  describe('storeMemory', () => {
    it('should store a memory', () => {
      const memory = service.storeMemory({
        content: 'Test memory',
        priority: 'fact',
      });

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory');
      expect(memory.priority).toBe('fact');
    });

    it('should deduplicate by content hash', () => {
      const m1 = service.storeMemory({ content: 'Duplicate test', priority: 'fact' });
      const m2 = service.storeMemory({ content: 'Duplicate test', priority: 'fact' });
      expect(m1.id).toBe(m2.id);
    });

    it('should store with TTL', () => {
      const expiresAt = new Date(Date.now() + 3600000);
      const memory = service.storeMemory({
        content: 'TTL memory',
        priority: 'fact',
        expiresAt,
      });
      expect(memory.expiresAt).toBeInstanceOf(Date);
    });

    it('should store with project tags', () => {
      const memory = service.storeMemory({
        content: 'Tagged memory',
        priority: 'fact',
        projectTags: ['typescript', 'testing'],
      });
      expect(memory.projectTags).toContain('typescript');
    });

    it('should store anchored memories', () => {
      const memory = service.storeMemory({
        content: 'Anchored memory',
        priority: 'constraint',
        anchored: true,
      });
      expect(memory.anchored).toBe(true);
    });
  });

  describe('recallMemories', () => {
    beforeEach(() => {
      service.storeMemory({ content: 'TypeScript is typed', priority: 'fact' });
      service.storeMemory({ content: 'Rust is fast', priority: 'fact' });
      service.storeMemory({ content: 'JavaScript is dynamic', priority: 'fact' });
    });

    it('should recall by keyword search', () => {
      const results = service.recallMemories({ query: 'TypeScript', limit: 10 }, 'keyword');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit', () => {
      const results = service.recallMemories({ query: '', limit: 2 }, 'keyword');
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should handle empty query', () => {
      const results = service.recallMemories({ query: '', limit: 10 }, 'keyword');
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by project tags', () => {
      service.storeMemory({
        content: 'Tagged memory',
        priority: 'fact',
        projectTags: ['special'],
      });
      const results = service.recallMemories(
        { query: 'Tagged', projectTags: ['special'], limit: 10 },
        'keyword'
      );
      expect(results.every(m => m.projectTags.includes('special'))).toBe(true);
    });
  });

  describe('anchorMemory', () => {
    it('should anchor existing memory', () => {
      const memory = service.storeMemory({ content: 'To anchor', priority: 'fact' });
      const anchored = service.anchorMemory(memory.id);
      expect(anchored.anchored).toBe(true);
    });
  });

  describe('removeMemory', () => {
    it('should soft delete memory', () => {
      const memory = service.storeMemory({ content: 'To delete', priority: 'fact' });
      service.removeMemory(memory.id);
      const found = service.getMemory(memory.id);
      expect(found).toBeNull();
    });
  });

  describe('listAllMemories', () => {
    it('should list all memories', () => {
      service.storeMemory({ content: 'Memory 1', priority: 'fact' });
      service.storeMemory({ content: 'Memory 2', priority: 'fact' });
      const memories = service.listAllMemories();
      expect(memories.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by project tags', () => {
      service.storeMemory({ content: 'Tagged', priority: 'fact', projectTags: ['test'] });
      const memories = service.listAllMemories(['test']);
      expect(memories.every(m => m.projectTags.includes('test'))).toBe(true);
    });
  });

  describe('getHighPriorityMemories', () => {
    it('should return only high priority memories', () => {
      service.storeMemory({ content: 'Constraint', priority: 'constraint' });
      service.storeMemory({ content: 'Fact', priority: 'fact' });
      const highPriority = service.getHighPriorityMemories();
      expect(highPriority.every(m => ['anchored', 'constraint'].includes(m.priority))).toBe(true);
    });
  });

  describe('isMemoryHighPriority', () => {
    it('should return true for high priority', () => {
      const memory = service.storeMemory({ content: 'Constraint', priority: 'constraint' });
      expect(service.isMemoryHighPriority(memory)).toBe(true);
    });

    it('should return false for low priority', () => {
      const memory = service.storeMemory({ content: 'Fact', priority: 'fact' });
      expect(service.isMemoryHighPriority(memory)).toBe(false);
    });

    it('should return false for null', () => {
      expect(service.isMemoryHighPriority(null)).toBe(false);
    });
  });

  describe('cleanupExpired', () => {
    it('should clean up expired memories', () => {
      service.storeMemory({
        content: 'Expired',
        priority: 'fact',
        expiresAt: new Date(Date.now() - 1000),
      });
      const cleaned = service.cleanupExpired();
      expect(cleaned).toBeGreaterThan(0);
    });
  });

  describe('rebuildSearchIndex', () => {
    it('should rebuild index and return count', () => {
      service.storeMemory({ content: 'Indexable', priority: 'fact' });
      const count = service.rebuildSearchIndex();
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isSearchIndexAvailable', () => {
    it('should report index availability', () => {
      const available = service.isSearchIndexAvailable();
      expect(typeof available).toBe('boolean');
    });
  });
});
