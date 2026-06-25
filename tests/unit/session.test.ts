import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemorySession,
  getMemorySession,
  getMemorySessionByIsolation,
  listMemorySessions,
  updateMemorySession,
  deleteMemorySession,
  cleanupExpiredMemorySessions
} from '../../src/schema/memory-session.js';

describe('Memory Sessions', () => {
  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createMemorySession', () => {
    it('should create a session with default isolation', () => {
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'test-key',
        value: 'test-value'
      });

      expect(session.id).toBeDefined();
      expect(session.key).toBe('test-key');
      expect(session.value).toBe('test-value');
      expect(session.scope).toBe('session');
      expect(session.userId).toBe('user1');
      expect(session.agentId).toBe('agent1');
      expect(session.projectId).toBe('project1');
    });

    it('should create session with metadata', () => {
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'meta-key',
        value: 'value',
        meta: { type: 'test', version: 1 }
      });

      expect(session.meta).toEqual({ type: 'test', version: 1 });
    });

    it('should create session with expiration', () => {
      const future = new Date(Date.now() + 3600000);
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'expires-key',
        value: 'value',
        expiresAt: future
      });

      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('should create sessions with all scope types', () => {
      const scopes = ['session', 'short', 'long', 'archival'] as const;

      for (const scope of scopes) {
        const session = createMemorySession({
          userId: 'user1',
          agentId: 'agent1',
          projectId: 'project1',
          scope,
          key: `key-${scope}`,
          value: 'test'
        });
        expect(session.scope).toBe(scope);
      }
    });
  });

  describe('getMemorySession', () => {
    it('should retrieve a session by id', () => {
      const created = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'retrieve-key',
        value: 'retrieve-value'
      });

      const retrieved = getMemorySession(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.value).toBe('retrieve-value');
    });

    it('should return null for non-existent session', () => {
      const result = getMemorySession('non-existent');
      expect(result).toBeNull();
    });

    it('should return null for deleted session', () => {
      const created = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'deleted-key',
        value: 'deleted-value'
      });

      deleteMemorySession(created.id);
      const result = getMemorySession(created.id);
      expect(result).toBeNull();
    });
  });

  describe('getMemorySessionByIsolation', () => {
    it('should retrieve session by isolation tuple', () => {
      const created = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'unique-key',
        value: 'isolated-value'
      });

      const retrieved = getMemorySessionByIsolation({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'unique-key'
      });

      expect(retrieved).not.toBeNull();
      expect(retrieved?.value).toBe('isolated-value');
    });

    it('should return null when isolation does not match', () => {
      createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'key',
        value: 'value1'
      });

      const result = getMemorySessionByIsolation({
        userId: 'user2', // Different user
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'key'
      });

      expect(result).toBeNull();
    });
  });

  describe('listMemorySessions', () => {
    it('should list sessions for a user', () => {
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'key1', value: 'value1'
      });
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'key2', value: 'value2'
      });

      const sessions = listMemorySessions({ userId: 'user1' });
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by scope', () => {
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'session-key', value: 'value'
      });
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'long', key: 'long-key', value: 'value'
      });

      const sessions = listMemorySessions({ userId: 'user1', scope: 'session' });
      expect(sessions.every(s => s.scope === 'session')).toBe(true);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 20; i++) {
        createMemorySession({
          userId: 'user1', agentId: 'agent1', projectId: 'project1',
          scope: 'session', key: `key${i}`, value: `value${i}`
        });
      }

      const sessions = listMemorySessions({ userId: 'user1', limit: 5 });
      expect(sessions.length).toBeLessThanOrEqual(5);
    });
  });

  describe('updateMemorySession', () => {
    it('should update session value', () => {
      const created = createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'update-key', value: 'old-value'
      });

      const updated = updateMemorySession(created.id, { value: 'new-value' });
      expect(updated.value).toBe('new-value');
      expect(updated.version).toBe(created.version + 1);
    });

    it('should update session metadata', () => {
      const created = createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'meta-key', value: 'value'
      });

      const updated = updateMemorySession(created.id, { meta: { updated: true } });
      expect(updated.meta).toEqual({ updated: true });
    });

    it('should extend expiration', () => {
      const created = createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'expire-key', value: 'value'
      });

      const newExpiry = new Date(Date.now() + 7200000);
      const updated = updateMemorySession(created.id, { expiresAt: newExpiry });
      expect(updated.expiresAt?.getTime()).toBeGreaterThan(created.expiresAt?.getTime() || 0);
    });
  });

  describe('deleteMemorySession', () => {
    it('should soft delete a session', () => {
      const created = createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'delete-key', value: 'value'
      });

      deleteMemorySession(created.id);
      const result = getMemorySession(created.id);
      expect(result).toBeNull();
    });
  });

  describe('cleanupExpiredMemorySessions', () => {
    it('should cleanup expired sessions', () => {
      // Create an already expired session
      const past = new Date(Date.now() - 1000);
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'expired-key', value: 'expired-value',
        expiresAt: past
      });

      // Create a non-expired session
      const future = new Date(Date.now() + 3600000);
      createMemorySession({
        userId: 'user1', agentId: 'agent1', projectId: 'project1',
        scope: 'session', key: 'valid-key', value: 'valid-value',
        expiresAt: future
      });

      const stats = cleanupExpiredMemorySessions();
      expect(stats.sessionRemoved).toBe(1);
      expect(stats.shortRemoved).toBe(0);
    });
  });
});
