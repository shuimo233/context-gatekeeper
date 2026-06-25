import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { getContextCompressor, ContextCompressor } from '../../src/services/compressor/trigger.js';
import { getThresholdDetector, ThresholdDetector } from '../../src/services/compressor/threshold.js';
import { createMemory } from '../../src/schema/memory.js';

describe('Compressor Service', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('ContextCompressor', () => {
    it('should compress memories to target ratio', async () => {
      for (let i = 0; i < 10; i++) {
        createMemory({ content: `Memory ${i} with some content`, priority: 'fact' });
      }

      const compressor = getContextCompressor();
      const result = await compressor.compress(0.5);
      expect(result.id).toBeDefined();
      expect(result.remainingRatio).toBeLessThanOrEqual(1);
    });

    it('should not compress anchored memories', async () => {
      createMemory({ content: 'Anchored memory', priority: 'constraint', anchored: true });
      createMemory({ content: 'Regular memory', priority: 'fact' });

      const compressor = getContextCompressor();
      const result = await compressor.compress(0.3);
      expect(result.compressedCount).toBeLessThanOrEqual(1);
    });

    it('should return zero compression for already compressed', async () => {
      const compressor = getContextCompressor();
      const result = await compressor.compress(0.9);
      expect(result.compressedCount).toBe(0);
    });
  });

  describe('ThresholdDetector', () => {
    it('should detect when compression is needed', () => {
      const detector = getThresholdDetector();

      expect(detector.shouldCompress(0.45)).toBe(true);
      expect(detector.shouldCompress(0.3)).toBe(false);
      expect(detector.shouldCompress(0.6)).toBe(false);
    });

    it('should report usage correctly', () => {
      const detector = new ThresholdDetector(0.4, 0.5);
      const response = detector.reportUsage(45000, 100000);

      expect(response.shouldCompress).toBe(true);
      expect(response.currentRatio).toBeCloseTo(0.45, 2);
    });

    it('should get thresholds', () => {
      const detector = getThresholdDetector();
      const thresholds = detector.getThresholds();
      expect(thresholds.low).toBeCloseTo(0.4);
      expect(thresholds.high).toBeCloseTo(0.5);
    });

    it('should set thresholds', () => {
      const detector = new ThresholdDetector();
      detector.setThresholds(0.3, 0.6);
      expect(detector.shouldCompress(0.45)).toBe(true);
    });

    it('should reject invalid thresholds', () => {
      const detector = new ThresholdDetector();
      expect(() => detector.setThresholds(0.6, 0.3)).toThrow();
      expect(() => detector.setThresholds(-0.1, 0.5)).toThrow();
      expect(() => detector.setThresholds(0.3, 1.5)).toThrow();
    });
  });
});
