import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  checkDatabaseHealth,
  executeWALCheckpoint,
  getDatabaseMetrics,
  calculateDatabaseHealthScore,
} from '../../src/services/database-health.js';

describe('Health API', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('checkDatabaseHealth', () => {
    it('should return healthy status', async () => {
      const health = await checkDatabaseHealth();
      expect(health.status).toBe('healthy');
      expect(health.details).toHaveProperty('journalMode');
    });

    it('should include checkedAt timestamp', async () => {
      const health = await checkDatabaseHealth();
      expect(health.checkedAt).toBeDefined();
      expect(new Date(health.checkedAt)).toBeInstanceOf(Date);
    });
  });

  describe('executeWALCheckpoint', () => {
    it('should execute checkpoint', async () => {
      const result = await executeWALCheckpoint();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('mode');
      expect(result).toHaveProperty('changes');
    });
  });

  describe('getDatabaseMetrics', () => {
    it('should return database metrics', async () => {
      const metrics = await getDatabaseMetrics();
      expect(metrics).toHaveProperty('pageSize');
      expect(metrics).toHaveProperty('pageCount');
      expect(metrics).toHaveProperty('walSize');
      expect(metrics).toHaveProperty('cacheHitRate');
    });

    it('should return valid numbers', async () => {
      const metrics = await getDatabaseMetrics();
      expect(metrics.pageSize).toBeGreaterThan(0);
      expect(typeof metrics.cacheHitRate).toBe('number');
    });
  });

  describe('calculateDatabaseHealthScore', () => {
    it('should return score between 0 and 100', () => {
      const metrics = {
        pageCount: 1000,
        walSize: 1024 * 1024,
        cacheHitRate: 0.95,
        lastCheckpoint: new Date().toISOString(),
      };
      const score = calculateDatabaseHealthScore(metrics);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should penalize large WAL', () => {
      const normalMetrics = {
        pageCount: 1000, walSize: 1024, cacheHitRate: 0.95, lastCheckpoint: new Date().toISOString(),
      };
      const largeWALMetrics = {
        pageCount: 1000, walSize: 200 * 1024 * 1024, cacheHitRate: 0.95, lastCheckpoint: new Date().toISOString(),
      };
      const normalScore = calculateDatabaseHealthScore(normalMetrics);
      const largeWALScore = calculateDatabaseHealthScore(largeWALMetrics);
      expect(largeWALScore).toBeLessThan(normalScore);
    });
  });
});
