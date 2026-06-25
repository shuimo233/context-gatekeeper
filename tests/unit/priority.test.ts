import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  calculatePriorityScore,
  calculateTimeDecay,
  getPriorityWeight,
  isHighPriority
} from '../../src/utils/priority.js';
import { Priority } from '../../src/models/types.js';

describe('Priority Utilities', () => {
  describe('calculatePriorityScore', () => {
    it('should return 1.0 for anchored memories with no access', () => {
      const now = new Date();
      const score = calculatePriorityScore('anchored', 0, now, true);
      expect(score).toBeCloseTo(1.0, 5);
    });

    it('should return 0.8 for constraint priority', () => {
      const now = new Date();
      const score = calculatePriorityScore('constraint', 0, now, false);
      expect(score).toBeCloseTo(0.8, 5);
    });

    it('should return 0.6 for decision priority', () => {
      const now = new Date();
      const score = calculatePriorityScore('decision', 0, now, false);
      expect(score).toBeCloseTo(0.6, 5);
    });

    it('should return 0.4 for preference priority', () => {
      const now = new Date();
      const score = calculatePriorityScore('preference', 0, now, false);
      expect(score).toBeCloseTo(0.4, 5);
    });

    it('should return 0.2 for fact priority', () => {
      const now = new Date();
      const score = calculatePriorityScore('fact', 0, now, false);
      expect(score).toBeCloseTo(0.2, 5);
    });

    it('should increase score with access count', () => {
      const now = new Date();
      const score0 = calculatePriorityScore('constraint', 0, now, false);
      const score10 = calculatePriorityScore('constraint', 10, now, false);
      expect(score10).toBeGreaterThan(score0);
    });

    it('should not apply time decay to anchored memories', () => {
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
      const score = calculatePriorityScore('anchored', 0, oldDate, true);
      expect(score).toBeCloseTo(1.0, 5);
    });
  });

  describe('calculateTimeDecay', () => {
    it('should return 1.0 for anchored memories', () => {
      const now = new Date();
      expect(calculateTimeDecay(now, true)).toBe(1.0);
    });

    it('should decay over time for non-anchored memories', () => {
      const now = new Date();
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const decayNow = calculateTimeDecay(now, false);
      const decayOld = calculateTimeDecay(oldDate, false);
      expect(decayOld).toBeLessThan(decayNow);
    });
  });

  describe('getPriorityWeight', () => {
    it('should return correct weights for all priorities', () => {
      expect(getPriorityWeight('anchored')).toBe(1.0);
      expect(getPriorityWeight('constraint')).toBe(0.8);
      expect(getPriorityWeight('decision')).toBe(0.6);
      expect(getPriorityWeight('preference')).toBe(0.4);
      expect(getPriorityWeight('fact')).toBe(0.2);
    });
  });

  describe('isHighPriority', () => {
    it('should return true for anchored', () => {
      expect(isHighPriority('anchored')).toBe(true);
    });

    it('should return true for constraint', () => {
      expect(isHighPriority('constraint')).toBe(true);
    });

    it('should return false for decision', () => {
      expect(isHighPriority('decision')).toBe(false);
    });

    it('should return false for preference', () => {
      expect(isHighPriority('preference')).toBe(false);
    });

    it('should return false for fact', () => {
      expect(isHighPriority('fact')).toBe(false);
    });
  });
});
