import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { createCompression, getCompressionsByMemory, deleteCompressionsByMemory } from '../../src/schema/compression.js';
import { createMemory } from '../../src/schema/memory.js';

describe('Compression Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createCompression', () => {
    it('should create snapshot compression', () => {
      const memory = createMemory({ content: 'Original content', priority: 'fact' });
      const compression = createCompression(
        memory.id,
        'snapshot',
        { version: 1 },
        'Compressed summary'
      );

      expect(compression.id).toBeDefined();
      expect(compression.memoryId).toBe(memory.id);
      expect(compression.operation).toBe('snapshot');
      expect(compression.summary).toBe('Compressed summary');
    });

    it('should create archive compression', () => {
      const memory = createMemory({ content: 'Archive me', priority: 'fact' });
      const compression = createCompression(
        memory.id,
        'archive',
        { archivedAt: new Date().toISOString() },
        'Archived summary'
      );

      expect(compression.operation).toBe('archive');
    });

    it('should create update compression', () => {
      const memory = createMemory({ content: 'Update me', priority: 'fact' });
      const compression = createCompression(
        memory.id,
        'update',
        { changes: ['content'] },
        'Update summary'
      );

      expect(compression.operation).toBe('update');
    });
  });

  describe('getCompressionsByMemory', () => {
    it('should get all compressions for a memory', () => {
      const memory = createMemory({ content: 'Test', priority: 'fact' });
      createCompression(memory.id, 'snapshot', {}, 'Snap 1');
      createCompression(memory.id, 'archive', {}, 'Arch 1');
      createCompression(memory.id, 'snapshot', {}, 'Snap 2');

      const compressions = getCompressionsByMemory(memory.id);
      expect(compressions.length).toBe(3);
    });

    it('should return empty for memory with no compressions', () => {
      const memory = createMemory({ content: 'NoCompress', priority: 'fact' });
      const compressions = getCompressionsByMemory(memory.id);
      expect(compressions.length).toBe(0);
    });
  });

  describe('deleteCompressionsByMemory', () => {
    it('should delete all compressions for a memory', () => {
      const memory = createMemory({ content: 'DeleteCompressions', priority: 'fact' });
      createCompression(memory.id, 'snapshot', {}, 'Snap');
      createCompression(memory.id, 'archive', {}, 'Arch');

      deleteCompressionsByMemory(memory.id);
      const compressions = getCompressionsByMemory(memory.id);
      expect(compressions.length).toBe(0);
    });
  });
});
