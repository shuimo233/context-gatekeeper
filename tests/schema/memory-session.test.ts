import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createMemorySession,
  getMemorySession,
  getMemorySessionByIsolation,
  listMemorySessions,
  updateMemorySession,
  deleteMemorySession,
  cleanupExpiredMemorySessions,
} from '../../src/schema/memory-session.js';

describe('MemorySession Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createMemorySession', () => {
    it('should create a session record', () => {
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'test-key',
        value: 'test-value',
      });

      expect(session.id).toBeDefined();
      expect(session.userId).toBe('user1');
      expect(session.agentId).toBe('agent1');
      expect(session.projectId).toBe('project1');
      expect(session.scope).toBe('session');
      expect(session.key).toBe('test-key');
      expect(session.value).toBe('test-value');
      expect(session.deleted).toBe(false);
    });

    it('should create with all scopes', () => {
      const scopes = ['session', 'short', 'long', 'archival'] as const;
      for (const scope of scopes) {
        const session = createMemorySession({
          userId: 'user1',
          agentId: 'agent1',
          projectId: 'project1',
          scope,
          key: `key-${scope}`,
        });
        expect(session.scope).toBe(scope);
      }
    });

    it('should create with metadata', () => {
      const meta = { source: 'test', count: 42 };
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'meta-key',
        meta,
      });
      expect(session.meta).toEqual(meta);
    });

    it('should create with TTL', () => {
      const ttl = new Date(Date.now() + 3600000);
      const session = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'ttl-key',
        expiresAt: ttl,
      });
      expect(session.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('getMemorySession', () => {
    it('should retrieve existing session', () => {
      const created = createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'find-me',
      });
      const found = getMemorySession(created.id);
      expect(found).not.toBeNull();
      expect(found?.key).toBe('find-me');
    });

    it('should return null for non-existent', () => {
      const found = getMemorySession('ms-nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('getMemorySessionByIsolation', () => {
    it('should find by isolation tuple', () => {
      createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'tuple-key',
      });
      const found = getMemorySessionByIsolation({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'tuple-key',
      });
      expect(found).not.toBeNull();
    });

    it('should not find with wrong isolation', () => {
      createMemorySession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'isolated-key',
      });
      const found = getMemorySessionByIsolation({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'wrong-key',
      });
      expect(found).toBeNull();
    });
  });

  describe('listMemorySessions', () => {
    it('should list all sessions for user', () => {
      createMemorySession({
        userId: 'user1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 's1',
      });
      createMemorySession({
        userId: 'user1', agentId: 'a2', projectId: 'p2',
        scope: 'session', key: 's2',
      });
      const sessions = listMemorySessions({ userId: 'user1' });
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by scope', () => {
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'session-key',
      });
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'long', key: 'long-key',
      });
      const sessions = listMemorySessions({ userId: 'u1', scope: 'session' });
      expect(sessions.every(s => s.scope === 'session')).toBe(true);
    });

    it('should filter by project', () => {
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'proj-a',
        scope: 'session', key: 'proj-a-key',
      });
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'proj-b',
        scope: 'session', key: 'proj-b-key',
      });
      const sessions = listMemorySessions({ projectId: 'proj-a' });
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions[0].projectId).toBe('proj-a');
    });
  });

  describe('updateMemorySession', () => {
    it('should update value', () => {
      const session = createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'update-key',
      });
      const updated = updateMemorySession(session.id, { value: 'new-value' });
      expect(updated.value).toBe('new-value');
      expect(updated.version).toBeGreaterThan(session.version);
    });

    it('should update metadata', () => {
      const session = createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'meta-key',
      });
      const updated = updateMemorySession(session.id, { meta: { updated: true } });
      expect(updated.meta).toEqual({ updated: true });
    });

    it('should set expiration', () => {
      const session = createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'expire-key',
      });
      const future = new Date(Date.now() + 7200000);
      const updated = updateMemorySession(session.id, { expiresAt: future });
      expect(updated.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('deleteMemorySession', () => {
    it('should soft delete session', () => {
      const session = createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'delete-key',
      });
      deleteMemorySession(session.id);
      const found = getMemorySession(session.id);
      expect(found).toBeNull();
    });

    it('should throw for non-existent', () => {
      expect(() => deleteMemorySession('ms-nonexistent')).toThrow();
    });
  });

  describe('cleanupExpiredMemorySessions', () => {
    it('should clean up expired sessions', () => {
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'expired-1',
        expiresAt: new Date(Date.now() - 1000),
      });
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'expired-2',
        expiresAt: new Date(Date.now() - 2000),
      });
      const stats = cleanupExpiredMemorySessions();
      expect(stats.sessionRemoved).toBeGreaterThan(0);
    });

    it('should return zero counts when nothing expired', () => {
      createMemorySession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'long', key: 'valid-key',
        expiresAt: new Date(Date.now() + 86400000),
      });
      const stats = cleanupExpiredMemorySessions();
      expect(stats.sessionRemoved).toBe(0);
    });
  });
});
