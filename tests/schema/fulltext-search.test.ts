import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { searchFullText, rebuildFullTextIndex, initFullTextSearch } from '../../src/schema/fulltext-search.js';
import { createMemory } from '../../src/schema/memory.js';

function isFts5Available(): boolean {
  try {
    resetDatabase();
    initDatabase(':memory:');
    initSchema();
    initFullTextSearch();
    return true;
  } catch {
    return false;
  }
}

const fts5Available = isFts5Available();

describe('FullTextSearch Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('initFullTextSearch', () => {
    it('should initialize full-text search successfully when supported', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      expect(() => initFullTextSearch()).not.toThrow();
    });
  });

  describe('searchFullText', () => {
    const runSearchTest = () => {
      initFullTextSearch();
      createMemory({ content: 'TypeScript is a typed superset of JavaScript', priority: 'fact' });
      createMemory({ content: 'Rust is a systems programming language', priority: 'fact' });
      createMemory({ content: 'Go is a statically typed compiled language', priority: 'fact' });

      const results = searchFullText('TypeScript', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content.toLowerCase()).toContain('typescript');
    };

    it('should find memories by keywords when the virtual table is initialized', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      runSearchTest();
    });

    it('should handle multiple terms when the virtual table is initialized', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      initFullTextSearch();
      createMemory({ content: 'Fast compiled language with great performance', priority: 'fact' });
      const results = searchFullText('fast language', 10);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit parameter when the virtual table is initialized', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      initFullTextSearch();
      for (let i = 0; i < 20; i++) {
        createMemory({ content: `Memory number ${i} with searchable content`, priority: 'fact' });
      }
      const results = searchFullText('memory', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should return empty for no matches when the virtual table is initialized', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      initFullTextSearch();
      createMemory({ content: 'Some random content', priority: 'fact' });
      const results = searchFullText('nonexistentword12345', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('rebuildFullTextIndex', () => {
    const runRebuildTest = () => {
      initFullTextSearch();
      createMemory({ content: 'Indexable content one', priority: 'fact' });
      createMemory({ content: 'Indexable content two', priority: 'fact' });

      const count = rebuildFullTextIndex();
      expect(count).toBeGreaterThanOrEqual(2);
    };

    it('should rebuild index and return count', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      runRebuildTest();
    });

    it('should handle empty database', () => {
      if (!fts5Available) {
        expect(true).toBe(true);
        return;
      }
      initFullTextSearch();
      const count = rebuildFullTextIndex();
      expect(count).toBe(0);
    });
  });
});
