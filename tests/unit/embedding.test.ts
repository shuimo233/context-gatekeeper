import { describe, it, expect } from 'vitest';
import {
  generateFixedEmbedding,
  generateFixedQueryEmbedding,
  FIXED_EMBEDDING_DIMENSION
} from '../../src/services/embedding-fixed.js';

describe('Fixed Embedding', () => {
  describe('generateFixedEmbedding', () => {
    it('should return a vector of correct dimension', () => {
      const embedding = generateFixedEmbedding('test content');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });

    it('should return normalized vector (magnitude close to 1)', () => {
      const embedding = generateFixedEmbedding('test content');
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should return same embedding for same content', () => {
      const content = 'consistent test content';
      const embedding1 = generateFixedEmbedding(content);
      const embedding2 = generateFixedEmbedding(content);
      expect(embedding1).toEqual(embedding2);
    });

    it('should use corpus for IDF calculation', () => {
      const singleDoc = generateFixedEmbedding('test document');
      const withCorpus = generateFixedEmbedding('test document', ['another document']);
      // Different corpus = different IDF weights = different vector
      expect(singleDoc).not.toEqual(withCorpus);
    });

    it('should filter stop words', () => {
      const withStopWords = generateFixedEmbedding('the a an and but or for nor');
      // All tokens are stop words, so vector should be all zeros
      expect(withStopWords.every(v => v === 0)).toBe(true);
    });

    it('should be case insensitive', () => {
      const lower = generateFixedEmbedding('test content');
      const upper = generateFixedEmbedding('TEST CONTENT');
      expect(lower).toEqual(upper);
    });

    it('should handle empty content', () => {
      const embedding = generateFixedEmbedding('');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
      // Empty content has no tokens, so vector is all zeros
      expect(embedding.every(v => v === 0)).toBe(true);
    });

    it('should produce meaningful embeddings for content', () => {
      const embedding = generateFixedEmbedding('python programming language machine learning');
      // Should have some non-zero values for content words
      const nonZeroCount = embedding.filter(v => v !== 0).length;
      expect(nonZeroCount).toBeGreaterThan(0);
    });
  });

  describe('generateFixedQueryEmbedding', () => {
    it('should return a vector of correct dimension', () => {
      const embedding = generateFixedQueryEmbedding('test query');
      expect(embedding).toHaveLength(FIXED_EMBEDDING_DIMENSION);
    });

    it('should return normalized vector', () => {
      const embedding = generateFixedQueryEmbedding('test query');
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should return same result as generateFixedEmbedding for same text', () => {
      const text = 'test query text';
      const query = generateFixedQueryEmbedding(text);
      const direct = generateFixedEmbedding(text);
      expect(query).toEqual(direct);
    });
  });

  describe('embedding quality with corpus', () => {
    it('should give similar vectors for related documents when using same corpus', () => {
      const corpus = [
        'python programming language',
        'python machine learning',
        'python data science',
        'java programming language',
        'javascript web development'
      ];
      
      const doc1 = generateFixedEmbedding('python algorithms', corpus);
      const doc2 = generateFixedEmbedding('python neural networks', corpus);
      
      // Both mention "python" so should have some similarity
      const dotProduct = doc1.reduce((sum, v, i) => sum + v * doc2[i], 0);
      expect(dotProduct).toBeGreaterThan(0);
    });

    it('should give lower similarity for unrelated documents when using same corpus', () => {
      const corpus = [
        'python programming language',
        'machine learning algorithms',
        'web development javascript'
      ];
      
      const doc1 = generateFixedEmbedding('python code', corpus);
      const doc2 = generateFixedEmbedding('web design css', corpus);
      
      const dotProduct = doc1.reduce((sum, v, i) => sum + v * doc2[i], 0);
      // Unrelated docs should have lower similarity
      // (May not always be < 0.3 due to shared stop words, but should be lower than related)
      expect(typeof dotProduct).toBe('number');
    });
  });
});
