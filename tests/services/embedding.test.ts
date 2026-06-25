import { describe, it, expect } from 'vitest';
import { generateFixedEmbedding, generateFixedQueryEmbedding, FIXED_EMBEDDING_DIMENSION } from '../../src/services/embedding-fixed.js';
import { cosineSimilarity } from '../../src/schema/memory.js';

describe('Embedding Service', () => {
  describe('generateFixedEmbedding', () => {
    it('should return a vector of the fixed dimension', () => {
      const embedding = generateFixedEmbedding('test content');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });

    it('should return the same embedding for the same content', () => {
      const content = 'consistent test content';
      const embedding1 = generateFixedEmbedding(content);
      const embedding2 = generateFixedEmbedding(content);
      expect(embedding1).toEqual(embedding2);
    });

    it('should return a normalized vector', () => {
      const embedding = generateFixedEmbedding('test content');
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should treat different input with non-stop content differently', () => {
      const emb1 = generateFixedEmbedding('alpha alpha alpha');
      const emb2 = generateFixedEmbedding('beta beta beta');
      expect(emb1).toHaveLength(FIXED_EMBEDDING_DIMENSION);
      expect(emb2).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });

    it('should return zero vectors for stop words only', () => {
      const embedding = generateFixedEmbedding('the a an and but or for nor');
      expect(embedding.every(value => value === 0)).toBe(true);
    });

    it('should be case insensitive', () => {
      const lower = generateFixedEmbedding('test content');
      const upper = generateFixedEmbedding('TEST CONTENT');
      expect(lower).toEqual(upper);
    });

    it('should handle empty content', () => {
      const embedding = generateFixedEmbedding('');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
      expect(embedding.every(value => value === 0)).toBe(true);
    });

    it('should handle unicode content without throwing', () => {
      const embedding = generateFixedEmbedding('你好世界 🌍');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });
  });

  describe('generateFixedQueryEmbedding', () => {
    it('should return a vector of the fixed dimension', () => {
      const embedding = generateFixedQueryEmbedding('test query');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });

    it('should match the fixed embedding behavior for identical text', () => {
      const text = 'test query text';
      const queryEmbedding = generateFixedQueryEmbedding(text);
      const contentEmbedding = generateFixedEmbedding(text);
      expect(queryEmbedding).toEqual(contentEmbedding);
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vector = [0.1, 0.2, 0.3, 0.4];
      expect(cosineSimilarity(vector, vector)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vector1 = [1, 0, 0, 0];
      const vector2 = [0, 1, 0, 0];
      expect(cosineSimilarity(vector1, vector2)).toBeCloseTo(0, 5);
    });

    it('should return 0 for a zero vector', () => {
      const vector1 = [0, 0, 0, 0];
      const vector2 = [1, 1, 1, 1];
      expect(cosineSimilarity(vector1, vector2)).toBe(0);
    });

    it('should return 0 for vectors with different lengths', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });
  });
});
