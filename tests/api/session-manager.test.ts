import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  getOrCreateSession,
  readSession,
  listSessions,
  updateSession,
  touchSession,
  expireSession,
  cleanupExpired,
} from '../../src/api/session-manager.js';

describe('SessionManager API', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('getOrCreateSession', () => {
    it('should create a new session', async () => {
      const session = await getOrCreateSession({
        userId: 'user1',
        agentId: 'agent1',
        projectId: 'project1',
        scope: 'session',
        key: 'test-key',
      }, { value: 'initial-value' });

      expect(session).toBeDefined();
      expect(session.key).toBe('test-key');
      expect(session.value).toBe('initial-value');
    });

    it('should return existing session', async () => {
      await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'existing-key',
      }, { value: 'first' });
      const session = await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'existing-key',
      }, { value: 'second' });

      expect(session.value).toBe('first');
    });
  });

  describe('readSession', () => {
    it('should read existing session', async () => {
      await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'read-key',
      }, { value: 'read-value' });
      const session = await readSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'read-key',
      });

      expect(session).not.toBeNull();
      expect(session?.value).toBe('read-value');
    });

    it('should return null for non-existent', async () => {
      const session = await readSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'nonexistent',
      });
      expect(session).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('should list sessions for user', async () => {
      await getOrCreateSession({ userId: 'u1', agentId: 'a1', projectId: 'p1', scope: 'session', key: 'k1' }, { value: 'v1' });
      await getOrCreateSession({ userId: 'u1', agentId: 'a1', projectId: 'p1', scope: 'session', key: 'k2' }, { value: 'v2' });
      const sessions = await listSessions({ userId: 'u1' });
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by scope', async () => {
      await getOrCreateSession({ userId: 'u1', agentId: 'a1', projectId: 'p1', scope: 'session', key: 's1' }, { value: 'v1' });
      await getOrCreateSession({ userId: 'u1', agentId: 'a1', projectId: 'p1', scope: 'long', key: 'l1' }, { value: 'v2' });
      const sessions = await listSessions({ userId: 'u1', scope: 'session' });
      expect(sessions.every(s => s.scope === 'session')).toBe(true);
    });
  });

  describe('updateSession', () => {
    it('should update session value', async () => {
      await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'update-key',
      }, { value: 'old' });
      const updated = await updateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'update-key',
      }, { value: 'new' });
      expect(updated?.value).toBe('new');
    });
  });

  describe('touchSession', () => {
    it('should update timestamp', async () => {
      const original = await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'touch-key',
      }, { value: 'tv' });
      const touched = await touchSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'touch-key',
      });
      expect(touched?.updatedAt).toBeDefined();
    });
  });

  describe('expireSession', () => {
    it('should set expiration via ttlHours', async () => {
      const session = await getOrCreateSession({
        userId: 'u1', agentId: 'a1', projectId: 'p1',
        scope: 'session', key: 'expire-key',
      }, { value: 'ev', ttlHours: 1 });
      expect(session.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('cleanupExpired', () => {
    it('should cleanup expired sessions', async () => {
      const stats = await cleanupExpired();
      expect(stats).toHaveProperty('sessionRemoved');
      expect(stats).toHaveProperty('shortRemoved');
      expect(stats).toHaveProperty('longRemoved');
    });
  });
});
