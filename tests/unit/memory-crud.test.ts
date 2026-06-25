import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemory,
  getMemory,
  getMemoryOrThrow,
  updateMemory,
  deleteMemory,
  listMemories,
  searchMemories,
  incrementAccessCount,
  anchorMemory,
  getMemoriesByIds
} from '../../src/schema/memory.js';
import { MemoryNotFoundError } from '../../src/utils/errors.js';

describe('Memory CRUD Operations', () => {
  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createMemory', () => {
    it('should create a memory with all fields', () => {
      const memory = createMemory({
        content: 'Test memory content',
        priority: 'fact',
        projectTags: ['test']
      });

      expect(memory.id).toBeDefined();
      expect(memory.content).toBe('Test memory content');
      expect(memory.priority).toBe('fact');
      expect(memory.projectTags).toEqual(['test']);
      expect(memory.anchored).toBe(false);
      expect(memory.accessCount).toBe(0);
      expect(memory.deleted).toBe(false);
    });

    it('should create a memory with anchored=true', () => {
      const memory = createMemory({
        content: 'Anchored memory',
        priority: 'anchored',
        anchored: true
      });

      expect(memory.anchored).toBe(true);
      expect(memory.priority).toBe('anchored');
    });

    it('should create a memory with default isolation fields', () => {
      const memory = createMemory({
        content: 'Default isolation test',
        priority: 'fact'
      });

      expect(memory.userId).toBe('default');
      expect(memory.agentId).toBe('default');
      expect(memory.projectId).toBe('default');
    });

    it('should create a memory with custom isolation fields', () => {
      const memory = createMemory({
        content: 'Custom isolation test',
        priority: 'fact',
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1'
      });

      expect(memory.userId).toBe('user1');
      expect(memory.agentId).toBe('agent1');
      expect(memory.projectId).toBe('project1');
    });

    it('should create memory with lineage', () => {
      const memory = createMemory({
        content: 'Lineage test',
        priority: 'fact',
        parentId: 'parent-123'
      });

      expect(memory.parentId).toBe('parent-123');
      // lineage is [parentId] when parentId is provided
      expect(memory.lineage).toEqual(['parent-123']);
    });

    it('should set expiresAt when provided', () => {
      const futureDate = new Date(Date.now() + 3600000);
      const memory = createMemory({
        content: 'Expiring memory',
        priority: 'fact',
        expiresAt: futureDate
      });

      expect(memory.expiresAt).toBeInstanceOf(Date);
      expect(memory.expiresAt?.getTime()).toBeCloseTo(futureDate.getTime(), -3);
    });

    it('should create memory with all priority levels', () => {
      const priorities = ['anchored', 'constraint', 'decision', 'preference', 'fact'] as const;
      
      for (const priority of priorities) {
        const memory = createMemory({
          content: `Priority test: ${priority}`,
          priority
        });
        expect(memory.priority).toBe(priority);
      }
    });
  });

  describe('getMemory', () => {
    it('should retrieve an existing memory', () => {
      const created = createMemory({
        content: 'Retrieve test',
        priority: 'fact'
      });

      const retrieved = getMemory(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('Retrieve test');
    });

    it('should return null for non-existent id', () => {
      const result = getMemory('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null for deleted memory', () => {
      const created = createMemory({
        content: 'Will be deleted',
        priority: 'fact'
      });

      deleteMemory(created.id);
      const result = getMemory(created.id);
      expect(result).toBeNull();
    });
  });

  describe('getMemoryOrThrow', () => {
    it('should return memory when it exists', () => {
      const created = createMemory({
        content: 'OrThrow test',
        priority: 'fact'
      });

      const result = getMemoryOrThrow(created.id);
      expect(result.content).toBe('OrThrow test');
    });

    it('should throw MemoryNotFoundError when not found', () => {
      expect(() => getMemoryOrThrow('non-existent')).toThrow(MemoryNotFoundError);
    });
  });

  describe('updateMemory', () => {
    it('should update memory content', () => {
      const created = createMemory({
        content: 'Original content',
        priority: 'fact'
      });

      const updated = updateMemory(created.id, { content: 'Updated content' });
      expect(updated.content).toBe('Updated content');
      expect(updated.version).toBe(created.version + 1);
    });

    it('should update memory priority', () => {
      const created = createMemory({
        content: 'Priority change test',
        priority: 'fact'
      });

      const updated = updateMemory(created.id, { priority: 'constraint' });
      expect(updated.priority).toBe('constraint');
    });

    it('should update memory anchored status', () => {
      const created = createMemory({
        content: 'Anchored test',
        priority: 'fact',
        anchored: false
      });

      const updated = updateMemory(created.id, { anchored: true });
      expect(updated.anchored).toBe(true);
    });

    it('should update project tags', () => {
      const created = createMemory({
        content: 'Tags test',
        priority: 'fact',
        projectTags: ['old']
      });

      const updated = updateMemory(created.id, { projectTags: ['new', 'tags'] });
      expect(updated.projectTags).toEqual(['new', 'tags']);
    });

    it('should throw for non-existent memory', () => {
      expect(() => updateMemory('non-existent', { content: 'test' })).toThrow(MemoryNotFoundError);
    });

    it('should update expiresAt', () => {
      const created = createMemory({
        content: 'Expires test',
        priority: 'fact'
      });

      const newDate = new Date(Date.now() + 7200000);
      const updated = updateMemory(created.id, { expiresAt: newDate });
      expect(updated.expiresAt?.getTime()).toBeCloseTo(newDate.getTime(), -3);
    });
  });

  describe('deleteMemory', () => {
    it('should soft delete a memory', () => {
      const created = createMemory({
        content: 'Will be deleted',
        priority: 'fact'
      });

      deleteMemory(created.id);
      const result = getMemory(created.id);
      expect(result).toBeNull();
    });

    it('should throw for non-existent memory', () => {
      expect(() => deleteMemory('non-existent')).toThrow(MemoryNotFoundError);
    });
  });

  describe('listMemories', () => {
    it('should list all memories', () => {
      createMemory({ content: 'Memory 1', priority: 'fact' });
      createMemory({ content: 'Memory 2', priority: 'fact' });
      createMemory({ content: 'Memory 3', priority: 'fact' });

      const memories = listMemories();
      expect(memories.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by project tags', () => {
      createMemory({ content: 'Has tag', priority: 'fact', projectTags: ['special'] });
      createMemory({ content: 'No tag', priority: 'fact' });

      const filtered = listMemories(['special']);
      expect(filtered.length).toBe(1);
      expect(filtered[0].content).toBe('Has tag');
    });
  });

  describe('searchMemories', () => {
    it('should find memories by keyword', () => {
      createMemory({ content: 'Python is a programming language', priority: 'fact' });
      createMemory({ content: 'JavaScript is for the web', priority: 'fact' });

      const results = searchMemories('Python');
      expect(results.some(m => m.content.includes('Python'))).toBe(true);
    });

    it('should filter by project tags', () => {
      createMemory({ content: 'Found by tag', priority: 'fact', projectTags: ['searchable'] });
      createMemory({ content: 'Not found', priority: 'fact' });

      const results = searchMemories('Found', ['searchable']);
      expect(results.length).toBe(1);
      expect(results[0].content).toBe('Found by tag');
    });

    it('should return empty for non-matching query', () => {
      createMemory({ content: 'Something specific', priority: 'fact' });
      const results = searchMemories('xyz123nonexistent');
      expect(results.length).toBe(0);
    });
  });

  describe('incrementAccessCount', () => {
    it('should increment access count', () => {
      const created = createMemory({
        content: 'Access test',
        priority: 'fact'
      });

      expect(created.accessCount).toBe(0);
      incrementAccessCount(created.id);
      
      const after = getMemory(created.id);
      expect(after?.accessCount).toBe(1);
    });

    it('should increment multiple times', () => {
      const created = createMemory({
        content: 'Multi access test',
        priority: 'fact'
      });

      for (let i = 0; i < 5; i++) {
        incrementAccessCount(created.id);
      }

      const after = getMemory(created.id);
      expect(after?.accessCount).toBe(5);
    });
  });

  describe('anchorMemory', () => {
    it('should anchor an unanchored memory', () => {
      const created = createMemory({
        content: 'Will be anchored',
        priority: 'fact',
        anchored: false
      });

      const anchored = anchorMemory(created.id);
      expect(anchored.anchored).toBe(true);
    });
  });

  describe('getMemoriesByIds', () => {
    it('should retrieve memories by array of ids', () => {
      const m1 = createMemory({ content: 'Memory 1', priority: 'fact' });
      const m2 = createMemory({ content: 'Memory 2', priority: 'fact' });
      const m3 = createMemory({ content: 'Memory 3', priority: 'fact' });

      const results = getMemoriesByIds([m1.id, m3.id]);
      expect(results.length).toBe(2);
      expect(results.map(m => m.content).sort()).toEqual(['Memory 1', 'Memory 3']);
    });

    it('should return empty array for empty input', () => {
      const results = getMemoriesByIds([]);
      expect(results).toEqual([]);
    });
  });
});
