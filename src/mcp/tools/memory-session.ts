import { z } from 'zod';
import {
  createMemorySession,
  listMemorySessions,
  deleteMemorySession,
  getMemorySessionByIsolation,
  MemorySessionInput,
} from '../../schema/memory-session.js';

export const MemorySessionStoreInput = z.object({
  key: z.string().min(1).describe('Session memory key'),
  value: z.string().min(1).describe('Session memory value'),
  scope: z.enum(['session', 'short', 'long', 'archival']).default('session')
    .describe('Scope: session (window-close release), short (hours), long (days), archival (permanent)'),
  expires_in_hours: z.number().positive().optional().describe('TTL in hours (overrides scope default)'),
  meta: z.record(z.unknown()).optional().describe('Additional metadata'),
  user_id: z.string().optional().default('default'),
  agent_id: z.string().optional().default('default'),
  project_id: z.string().optional().default('default'),
});

export type MemorySessionStoreInputType = z.infer<typeof MemorySessionStoreInput>;

/** 存储会话级记忆 */
export async function memorySessionStoreTool(input: MemorySessionStoreInputType): Promise<{ id: string; key: string; scope: string }> {
  let expiresAt: Date | undefined;
  if (input.expires_in_hours) {
    expiresAt = new Date(Date.now() + input.expires_in_hours * 60 * 60 * 1000);
  } else {
    // 根据 scope 设置默认过期时间
    expiresAt = getDefaultExpiry(input.scope as MemorySessionInput['scope']);
  }

  const session = createMemorySession({
    userId: input.user_id,
    agentId: input.agent_id,
    projectId: input.project_id,
    scope: input.scope as MemorySessionInput['scope'],
    key: input.key,
    value: input.value,
    meta: input.meta,
    expiresAt,
  });

  return { id: session.id, key: session.key, scope: session.scope };
}

/** 获取会话级记忆 */
export const MemorySessionGetInput = z.object({
  key: z.string().min(1).describe('Session memory key'),
  user_id: z.string().optional().default('default'),
  agent_id: z.string().optional().default('default'),
  project_id: z.string().optional().default('default'),
  scope: z.enum(['session', 'short', 'long', 'archival']).default('session'),
});

export type MemorySessionGetInputType = z.infer<typeof MemorySessionGetInput>;

export async function memorySessionGetTool(input: MemorySessionGetInputType): Promise<{ id: string; key: string; value: string | null; scope: string } | null> {
  const session = getMemorySessionByIsolation({
    userId: input.user_id,
    agentId: input.agent_id,
    projectId: input.project_id,
    scope: input.scope as MemorySessionInput['scope'],
    key: input.key,
  });

  if (!session) return null;
  return { id: session.id, key: session.key, value: session.value, scope: session.scope };
}

/** 列出会话级记忆 */
export const MemorySessionListInput = z.object({
  user_id: z.string().optional().default('default'),
  agent_id: z.string().optional().default('default'),
  project_id: z.string().optional().default('default'),
  scope: z.enum(['session', 'short', 'long', 'archival']).optional(),
  limit: z.number().int().positive().optional().default(50),
});

export type MemorySessionListInputType = z.infer<typeof MemorySessionListInput>;

export async function memorySessionListTool(input: MemorySessionListInputType): Promise<{ sessions: Array<{ id: string; key: string; scope: string; value: string | null; updatedAt: string }> }> {
  const sessions = listMemorySessions({
    userId: input.user_id,
    agentId: input.agent_id,
    projectId: input.project_id,
    scope: input.scope as MemorySessionInput['scope'] | undefined,
    limit: input.limit,
  });

  return {
    sessions: sessions.map(s => ({
      id: s.id,
      key: s.key,
      scope: s.scope,
      value: s.value,
      updatedAt: s.updatedAt,
    })),
  };
}

/** 删除会话级记忆 */
export const MemorySessionDeleteInput = z.object({
  key: z.string().min(1).describe('Session memory key to delete'),
  user_id: z.string().optional().default('default'),
  agent_id: z.string().optional().default('default'),
  project_id: z.string().optional().default('default'),
  scope: z.enum(['session', 'short', 'long', 'archival']).default('session'),
});

export type MemorySessionDeleteInputType = z.infer<typeof MemorySessionDeleteInput>;

export async function memorySessionDeleteTool(input: MemorySessionDeleteInputType): Promise<{ deleted: boolean }> {
  const session = getMemorySessionByIsolation({
    userId: input.user_id,
    agentId: input.agent_id,
    projectId: input.project_id,
    scope: input.scope as MemorySessionInput['scope'],
    key: input.key,
  });

  if (!session) return { deleted: false };
  deleteMemorySession(session.id);
  return { deleted: true };
}

/** 根据 scope 返回默认过期时间 */
function getDefaultExpiry(scope: MemorySessionInput['scope']): Date | undefined {
  const now = Date.now();
  switch (scope) {
    case 'session': return undefined; // 随窗口关闭释放
    case 'short': return new Date(now + 4 * 60 * 60 * 1000); // 4 小时
    case 'long': return new Date(now + 7 * 24 * 60 * 60 * 1000); // 7 天
    case 'archival': return undefined; // 永不过期
  }
}
