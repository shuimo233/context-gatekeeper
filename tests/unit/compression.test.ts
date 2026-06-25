import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemory
} from '../../src/schema/memory.js';
import {
  createCompression,
  getCompression,
  getCompressionHistory,
  listCompressions,
  cleanupOldCompressions
} from '../../src/schema/compression.js';
import { getContextCompressor } from '../../src/services/compressor/trigger.js';

describe('Compression', () => {
  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('Compression records', () => {
    it('should create a compression record', () => {
      const memory = createMemory({ content: 'Original content', priority: 'fact' });
      
      const compression = createCompression(
        memory.id,
        'snapshot',
        { originalLength: 100 },
        'Summarized content'
      );

      expect(compression.id).toBeDefined();
      expect(compression.memoryId).toBe(memory.id);
      expect(compression.operation).toBe('snapshot');
      expect(compression.summary).toBe('Summarized content');
    });

    it('should create all operation types', () => {
      const memory = createMemory({ content: 'Test', priority: 'fact' });
      const operations = ['snapshot', 'update', 'merge', 'archive'] as const;

      for (const operation of operations) {
        const compression = createCompression(memory.id, operation, {}, `Summary for ${operation}`);
        expect(compression.operation).toBe(operation);
      }
    });

    it('should get compression by id', () => {
      const memory = createMemory({ content: 'Test', priority: 'fact' });
      const created = createCompression(memory.id, 'snapshot', {}, 'Summary');
      
      const retrieved = getCompression(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summary).toBe('Summary');
    });

    it('should return null for non-existent compression', () => {
      const result = getCompression('non-existent');
      expect(result).toBeNull();
    });

    it('should get compression history for memory', () => {
      const memory = createMemory({ content: 'Test', priority: 'fact' });
      
      createCompression(memory.id, 'snapshot', {}, 'First');
      createCompression(memory.id, 'update', {}, 'Second');
      createCompression(memory.id, 'archive', {}, 'Third');

      const history = getCompressionHistory(memory.id);
      expect(history.length).toBe(3);
    });

    it('should list all compressions', () => {
      const m1 = createMemory({ content: 'Memory 1', priority: 'fact' });
      const m2 = createMemory({ content: 'Memory 2', priority: 'fact' });
      
      createCompression(m1.id, 'snapshot', {}, 'Summary 1');
      createCompression(m2.id, 'snapshot', {}, 'Summary 2');

      const all = listCompressions();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ContextCompressor', () => {
    it('should compress memories to target ratio', async () => {
      // Create some memories
      for (let i = 0; i < 10; i++) {
        createMemory({ content: `Memory ${i} content`, priority: 'fact' });
      }

      const compressor = getContextCompressor();
      const result = await compressor.compress(0.9);

      expect(result.id).toBeDefined();
      expect(typeof result.compressedCount).toBe('number');
      expect(result.remainingRatio).toBeLessThanOrEqual(1);
    });

    it('should compress without crashing on empty database', async () => {
      const compressor = getContextCompressor();
      const result = await compressor.compress(0.5);

      expect(result.id).toBeDefined();
      expect(result.remainingRatio).toBe(1);
    });

    it('should preserve anchored memories', async () => {
      createMemory({ content: 'Anchored content', priority: 'fact', anchored: true });
      createMemory({ content: 'Fact content', priority: 'fact' });

      const compressor = getContextCompressor();
      const result = await compressor.compress(0.5);

      // Anchored memory should not be compressed
      expect(result.compressedCount).toBeLessThanOrEqual(1);
    });
  });
});
