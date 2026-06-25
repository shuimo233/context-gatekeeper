import { initMemorySessions } from '../schema/memory-session.js';
import {
  createMemorySession as dbCreateMemorySession,
  getMemorySessionByIsolation,
  listMemorySessions,
  updateMemorySession,
  deleteMemorySession,
  cleanupExpiredMemorySessions
} from '../schema/memory-session.js';
import { withAudit, withAuditAsync } from './observability.js';
import type { AuditEventEmitter, MemorySessionRecord } from './observability.js';

export interface SessionManagerOptions {
  auditEventEmitter?: AuditEventEmitter;
}

export interface SessionKey {
  userId: string;
  agentId: string;
  projectId: string;
  scope: 'session' | 'short' | 'long' | 'archival';
  key: string;
}

export interface SessionInput {
  value?: string;
  meta?: Record<string, unknown>;
  ttlHours?: number;
  updatedBy?: string;
}

export class SessionManager {
  private initialized = false;

  constructor(_options: SessionManagerOptions = {}) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    initMemorySessions();
    this.initialized = true;
  }

  async getOrCreateSession(sessionKey: SessionKey, initial: SessionInput = {}): Promise<MemorySessionRecord> {
    await this.initialize();

    const targetKey = this.buildTargetKey(sessionKey);

    return withAudit(
      'session.getOrCreate',
      targetKey,
      () => {
        const existing = getMemorySessionByIsolation({
          userId: sessionKey.userId,
          agentId: sessionKey.agentId,
          projectId: sessionKey.projectId,
          scope: sessionKey.scope,
          key: sessionKey.key
        });

        if (existing) {
          return existing;
        }

        return dbCreateMemorySession({
          userId: sessionKey.userId,
          agentId: sessionKey.agentId,
          projectId: sessionKey.projectId,
          scope: sessionKey.scope,
          key: sessionKey.key,
          value: initial.value,
          meta: initial.meta,
          updatedBy: initial.updatedBy,
          expiresAt: this.resolveExpiresAt(initial.ttlHours)
        });
      },
      this.buildMetadata(sessionKey, { operation: 'getOrCreate', ttlHours: initial.ttlHours })
    );
  }

  async readSession(sessionKey: SessionKey): Promise<MemorySessionRecord | null> {
    await this.initialize();
    const targetKey = this.buildTargetKey(sessionKey);

    return withAudit(
      'session.read',
      targetKey,
      () =>
        getMemorySessionByIsolation({
          userId: sessionKey.userId,
          agentId: sessionKey.agentId,
          projectId: sessionKey.projectId,
          scope: sessionKey.scope,
          key: sessionKey.key
        }),
      this.buildMetadata(sessionKey)
    );
  }

  async listSessions(input: {
    userId?: string;
    agentId?: string;
    projectId?: string;
    scope?: SessionKey['scope'];
    limit?: number;
  } = {}) {
    await this.initialize();

    return withAudit(
      'session.list',
      input.projectId ?? 'unknown',
      () =>
        listMemorySessions({
          userId: input.userId,
          agentId: input.agentId,
          projectId: input.projectId,
          scope: input.scope,
          limit: Math.min(input.limit ?? 100, 500),
          includeDeleted: false
        }),
      { ...input, operation: 'list' }
    );
  }

  async updateSession(sessionKey: SessionKey, updates: SessionInput) {
    await this.initialize();
    const existing = await this.readSession(sessionKey);

    if (!existing) {
      throw new Error('Session not found');
    }

    const targetKey = this.buildTargetKey(sessionKey);

    return withAudit(
      'session.update',
      targetKey,
      () =>
        updateMemorySession(existing.id, {
          value: updates.value,
          meta: updates.meta,
          updatedBy: updates.updatedBy,
          expiresAt: this.resolveExpiresAt(updates.ttlHours)
        }),
      this.buildMetadata(sessionKey, updates as Record<string, unknown>)
    );
  }

  async touchSession(sessionKey: SessionKey, updatedBy?: string) {
    await this.initialize();
    const existing = await this.readSession(sessionKey);

    if (!existing) {
      throw new Error('Session not found');
    }

    const targetKey = this.buildTargetKey(sessionKey);

    return withAudit(
      'session.touch',
      targetKey,
      () => updateMemorySession(existing.id, { updatedBy }),
      this.buildMetadata(sessionKey, { updatedBy })
    );
  }

  async expireSession(sessionKey: SessionKey, updatedBy?: string) {
    await this.initialize();
    const existing = await this.readSession(sessionKey);

    if (!existing) {
      throw new Error('Session not found');
    }

    const targetKey = this.buildTargetKey(sessionKey);

    return withAudit(
      'session.expire',
      targetKey,
      () => updateMemorySession(existing.id, { deleted: true, updatedBy }),
      this.buildMetadata(sessionKey, { updatedBy })
    );
  }

  async expireAllProjectSessions(projectId: string, updatedBy?: string) {
    await this.initialize();

    return withAudit(
      'session.expireProject',
      projectId,
      async () => {
        const sessions = await listMemorySessions({ projectId, limit: 500 });
        for (const session of sessions) {
          deleteMemorySession(session.id);
        }
        return sessions.length;
      },
      { updatedBy, operation: 'expireAll' }
    );
  }

  async expireSessionsNow(): Promise<ReturnType<typeof cleanupExpiredMemorySessions>> {
    await this.initialize();

    return withAuditAsync(
      'session.cleanup',
      'cleanup',
      async () => cleanupExpiredMemorySessions(),
      { operation: 'cleanup' }
    );
  }

  private buildTargetKey(sessionKey: SessionKey): string {
    return [sessionKey.userId, sessionKey.agentId, sessionKey.projectId, sessionKey.scope, sessionKey.key].join(':');
  }

  private buildMetadata(sessionKey: SessionKey, extra?: Record<string, unknown>): Record<string, unknown> {
    return {
      userId: sessionKey.userId,
      agentId: sessionKey.agentId,
      projectId: sessionKey.projectId,
      scope: sessionKey.scope,
      key: sessionKey.key,
      ...extra
    };
  }

  private resolveExpiresAt(ttlHours?: number): Date | string | null {
    if (typeof ttlHours === 'number' && ttlHours > 0) {
      return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
    }

    return null;
  }
}
