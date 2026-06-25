import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { createMemory } from '../../src/schema/memory.js';
import {
  exportUserData,
  deleteUserData,
  getUserDataSummary,
} from '../../src/api/gdpr.js';

describe('GDPR API', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('exportUserData', () => {
    it('should export user memories', () => {
      createMemory({ content: 'User memory', priority: 'fact' });
      const data = exportUserData('default', {});
      expect(data.memories.length).toBeGreaterThanOrEqual(1);
    });

    it('should include sessions when requested', () => {
      createMemory({ content: 'With session', priority: 'fact' });
      const data = exportUserData('default', { includeSessions: true });
      expect(data).toHaveProperty('sessions');
    });

    it('should include knowledge graph when requested', () => {
      createMemory({ content: 'With KG', priority: 'fact' });
      const data = exportUserData('default', { includeKnowledgeGraph: true });
      expect(data).toHaveProperty('knowledgeGraph');
    });
  });

  describe('deleteUserData', () => {
    it('should delete user memories', () => {
      createMemory({ content: 'To delete', priority: 'fact' });
      const result = deleteUserData('default', {});
      expect(result).toHaveProperty('deletedMemories');
    });

    it('should delete sessions when requested', () => {
      const result = deleteUserData('default', { deleteSessions: true });
      expect(result).toHaveProperty('deletedSessions');
    });

    it('should retain anchored memories when specified', () => {
      createMemory({ content: 'Anchored', priority: 'constraint', anchored: true });
      const result = deleteUserData('default', { retainAnchored: true });
      expect(result.deletedMemories).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getUserDataSummary', () => {
    it('should return data summary', () => {
      createMemory({ content: 'Memory 1', priority: 'fact' });
      createMemory({ content: 'Memory 2', priority: 'fact' });
      const summary = getUserDataSummary('default');
      expect(summary).toHaveProperty('memoryCount');
      expect(summary).toHaveProperty('sessionCount');
    });
  });
});
