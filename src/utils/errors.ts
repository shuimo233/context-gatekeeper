// Custom error classes for Context Gatekeeper

export class ContextGatekeeperError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ContextGatekeeperError';
  }
}

export class DatabaseError extends ContextGatekeeperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DATABASE_ERROR', cause);
    this.name = 'DatabaseError';
  }
}

export class LLMError extends ContextGatekeeperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LLM_ERROR', cause);
    this.name = 'LLMError';
  }
}

export class MCPError extends ContextGatekeeperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'MCP_ERROR', cause);
    this.name = 'MCPError';
  }
}

export class CompressionError extends ContextGatekeeperError {
  constructor(message: string, cause?: unknown) {
    super(message, 'COMPRESSION_ERROR', cause);
    this.name = 'CompressionError';
  }
}

export class MemoryNotFoundError extends ContextGatekeeperError {
  constructor(memoryId: string) {
    super(`Memory not found: ${memoryId}`, 'MEMORY_NOT_FOUND');
    this.name = 'MemoryNotFoundError';
  }
}

export class ProjectNotFoundError extends ContextGatekeeperError {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`, 'PROJECT_NOT_FOUND');
    this.name = 'ProjectNotFoundError';
  }
}

// Error recovery strategies
export enum RecoveryStrategy {
  FALLBACK_TO_MEMORY = 'FALLBACK_TO_MEMORY',      // DB -> Memory
  FALLBACK_TO_RULES = 'FALLBACK_TO_RULES',        // LLM -> Rules
  GRACEFUL_DEGRADATION = 'GRACEFUL_DEGRADATION',  // Service -> Silent
  RETAIN_ORIGINAL = 'RETAIN_ORIGINAL'             // Compression -> Keep original
}

export interface ErrorContext {
  strategy: RecoveryStrategy;
  fallbackValue?: unknown;
  shouldLog: boolean;
}
