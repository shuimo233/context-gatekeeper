// Memory priority levels
export type Priority = 'anchored' | 'constraint' | 'decision' | 'preference' | 'fact';

// Memory entity
export interface Memory {
  id: string;
  userId: string;
  agentId: string;
  projectId: string;
  content: string;
  priority: Priority;
  projectTags: string[];
  anchored: boolean;
  accessCount: number;
  version: number;
  updatedBy: string | null;
  parentId: string | null;
  lineage: string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  deleted: boolean;
}

// Isolation context for multi-tenant operations
export interface IsolationContext {
  userId?: string;
  agentId?: string;
  projectId?: string;
}

// Default isolation context
export const DEFAULT_ISOLATION: IsolationContext = {
  userId: 'default',
  agentId: 'default',
  projectId: 'default'
};

// Compression record
export interface Compression {
  id: string;
  memoryId: string;
  operation: 'snapshot' | 'update' | 'merge' | 'archive';
  delta: Record<string, unknown>;
  summary: string;
  createdAt: Date;
}

// Project entity
export interface Project {
  id: string;
  name: string;
  rootPath: string | null;
  createdAt: Date;
}

// Input types (for creation)
export interface CreateMemoryInput {
  content: string;
  priority: Priority;
  projectTags?: string[];
  anchored?: boolean;
  expiresAt?: Date | null;
  userId?: string;
  agentId?: string;
  projectId?: string;
  parentId?: string;
}

export interface CreateProjectInput {
  name: string;
  rootPath?: string | null;
}

// Update types
export interface UpdateMemoryInput {
  content?: string;
  priority?: Priority;
  projectTags?: string[];
  anchored?: boolean;
  expiresAt?: Date | null;
  deleted?: boolean;
}

// Query types
export interface RecallMemoryInput {
  query: string;
  projectTags?: string[];
  limit?: number;
  userId?: string;
  agentId?: string;
  projectId?: string;
}

export interface ReportUsageInput {
  usedTokens: number;
  maxTokens: number;
}

// Response types
export interface MemoryResponse {
  shouldCompress: boolean;
  currentRatio: number;
}

export interface CompressionResult {
  id: string;
  compressedCount: number;
  remainingRatio: number;
}

// Priority weights for scoring
export const PRIORITY_WEIGHTS: Record<Priority, number> = {
  anchored: 1.0,
  constraint: 0.8,
  decision: 0.6,
  preference: 0.4,
  fact: 0.2
};

// Time decay factor for anchored memories (1.0 = no decay)
export const ANCHORED_DECAY_FACTOR = 1.0;

// Default time decay for non-anchored memories
export const DEFAULT_DECAY_FACTOR = 0.99;
