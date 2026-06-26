import {
  CreateMemoryInput,
  RecallMemoryInput,
  Memory,
  IsolationContext,
  DEFAULT_ISOLATION
} from '../models/types.js';
import {
  createMemory,
  getMemory,
  getMemoriesByIds,
  updateMemory,
  deleteMemory,
  listMemories,
  searchMemories as searchMemoriesOriginal,
  searchMemoriesBM25,
  searchMemoriesVector,
  searchMemoriesHybrid,
  incrementAccessCount,
  storeEmbedding,
  computeContentHash,
  findDuplicateByHash,
  cleanupExpiredMemories
} from '../schema/memory.js';
import { insertHNSWNode, getHNSWIndex } from './hnsw-index.js';
import { searchFullText, rebuildFullTextIndex } from '../schema/fulltext-search.js';
import { calculatePriorityScore, isHighPriority } from '../utils/priority.js';
import { getCurrentProvider } from '../services/embedding-provider.js';
import { transaction } from '../utils/db.js';

export type SearchMode = 'keyword' | 'semantic' | 'hybrid' | 'auto' | 'fulltext';

export interface MemoryStoreOptions {
  useTransaction?: boolean;
  isolation?: IsolationContext;
}

export class MemoryService {
  private isolationContext: IsolationContext;

  constructor(isolationContext: IsolationContext = DEFAULT_ISOLATION) {
    this.isolationContext = isolationContext;
  }

  setIsolationContext(context: Partial<IsolationContext>): void {
    this.isolationContext = { ...this.isolationContext, ...context };
  }

  getIsolationContext(): IsolationContext {
    return { ...this.isolationContext };
  }

  async storeMemory(input: CreateMemoryInput, updatedBy?: string, options: MemoryStoreOptions = {}) {
    const isolation = options.isolation || this.isolationContext;

    if (options.useTransaction) {
      return this.storeMemoryWithTransaction(input, updatedBy, isolation);
    }

    const contentHash = computeContentHash(input.content);
    const existing = findDuplicateByHash(contentHash, isolation);

    if (existing) {
      incrementAccessCount(existing.id);
      return existing;
    }

    const memoryInput = { ...input, ...isolation };
    const memory = createMemory(memoryInput, updatedBy);

    const provider = getCurrentProvider();
    const result = await provider.embed(input.content);
    const modelName = `${provider.name}-${provider.dimension}d`;

    storeEmbedding(memory.id, input.content, result.vector, modelName, 'v1', result.dimension);

    try {
      const idx = getHNSWIndex('default');
      if (idx) {
        insertHNSWNode('default', memory.id, result.vector, input.projectTags || []);
      }
    } catch {
      // HNSW index not initialised, skip silently
    }

    return memory;
  }

  async storeMemoryWithTransaction(input: CreateMemoryInput, updatedBy?: string, isolation?: IsolationContext) {
    const effectiveIsolation = isolation || this.isolationContext;
    const contentHash = computeContentHash(input.content);
    const existing = findDuplicateByHash(contentHash, effectiveIsolation);

    if (existing) {
      incrementAccessCount(existing.id);
      return existing;
    }

    const provider = getCurrentProvider();
    const result = await provider.embed(input.content);
    const modelName = `${provider.name}-${provider.dimension}d`;

    return transaction(() => {
      const memoryInput = { ...input, ...effectiveIsolation };
      const memory = createMemory(memoryInput, updatedBy);
      storeEmbedding(memory.id, input.content, result.vector, modelName, 'v1', result.dimension);

      try {
        const idx = getHNSWIndex('default');
        if (idx) {
          insertHNSWNode('default', memory.id, result.vector, input.projectTags || []);
        }
      } catch {
        // silent
      }

      return memory;
    });
  }

  async recallMemories(input: RecallMemoryInput, searchMode: SearchMode = 'auto') {
    const { query, projectTags, limit = 10, userId, agentId, projectId } = input;
    const isolation = { userId, agentId, projectId };

    let memories;

    const actualMode = searchMode === 'auto' ? this.detectSearchMode(query) : searchMode;

    switch (actualMode) {
      case 'keyword':
        memories = searchMemoriesBM25(query, projectTags, limit, isolation);
        break;
      case 'fulltext':
        memories = this.searchWithFullText(query, projectTags, limit, isolation);
        break;
      case 'semantic':
        try {
          const provider = getCurrentProvider();
          const result = await provider.embed(query);
          const results = searchMemoriesVector(result.vector, projectTags, limit, 0.1, isolation);
          memories = results.map(r => ({ ...r, similarity: r.similarity })) as ReturnType<typeof searchMemoriesOriginal>;
        } catch {
          memories = searchMemoriesBM25(query, projectTags, limit, isolation);
        }
        break;
      case 'hybrid':
        try {
          const provider = getCurrentProvider();
          const result = await provider.embed(query);
          const results = searchMemoriesHybrid(query, result.vector, projectTags, limit, 0.5, 0.5, isolation);
          memories = results as unknown as ReturnType<typeof searchMemoriesOriginal>;
        } catch {
          memories = searchMemoriesBM25(query, projectTags, limit, isolation);
        }
        break;
      default:
        memories = searchMemoriesBM25(query, projectTags, limit, isolation);
    }

    if (!query) {
      memories = listMemories(projectTags, isolation);
    }

    const scoredMemories: Array<{ memory: Memory; score: number }> = [];
    for (const memory of memories) {
      incrementAccessCount(memory.id);
      const score = calculatePriorityScore(
        memory.priority,
        memory.accessCount + 1,
        memory.createdAt,
        memory.anchored
      );
      scoredMemories.push({ memory, score });
    }

    scoredMemories.sort((a, b) => b.score - a.score);
    return scoredMemories.slice(0, limit).map(item => item.memory);
  }

  private searchWithFullText(queryText: string, projectTags?: string[], limit: number = 10, isolation?: IsolationContext): Memory[] {
    const results = searchFullText(queryText, limit);
    const memoryIds = results.map(result => result.memoryId);
    const memories = getMemoriesByIds(memoryIds, isolation);

    if (!projectTags || projectTags.length === 0) {
      return memories;
    }

    return memories.filter(memory => projectTags.every(tag => memory.projectTags.includes(tag)));
  }

  private detectSearchMode(query: string): SearchMode {
    if (query.length < 20) {
      return 'keyword';
    }

    const hasTechnicalTerms = /\b(api|function|class|error|bug|fix|implement|test|config)\b/i.test(query);
    if (hasTechnicalTerms) {
      return 'hybrid';
    }

    const hasNaturalLanguage = /\b(how|what|why|explain|describe|tell me about)\b/i.test(query);
    if (hasNaturalLanguage) {
      return 'semantic';
    }

    return 'hybrid';
  }

  getMemory(id: string) {
    return getMemory(id, this.isolationContext);
  }

  anchorMemory(id: string) {
    return updateMemory(id, { anchored: true }, undefined, this.isolationContext);
  }

  async updateMemoryContent(id: string, content: string, updatedBy?: string, options: MemoryStoreOptions = {}) {
    const isolation = options.isolation || this.isolationContext;

    if (options.useTransaction) {
      return this.updateMemoryContentWithTransaction(id, content, updatedBy, isolation);
    }

    const memory = updateMemory(id, { content }, updatedBy, isolation);

    const provider = getCurrentProvider();
    const result = await provider.embed(content);
    const modelName = `${provider.name}-${provider.dimension}d`;
    storeEmbedding(id, content, result.vector, modelName, 'v1', result.dimension);

    return memory;
  }

  async updateMemoryContentWithTransaction(id: string, content: string, updatedBy?: string, isolation?: IsolationContext) {
    const effectiveIsolation = isolation || this.isolationContext;

    const provider = getCurrentProvider();
    const result = await provider.embed(content);
    const modelName = `${provider.name}-${provider.dimension}d`;

    return transaction(() => {
      const memory = updateMemory(id, { content }, updatedBy, effectiveIsolation);
      storeEmbedding(id, content, result.vector, modelName, 'v1', result.dimension);
      return memory;
    });
  }

  removeMemory(id: string, updatedBy?: string): void {
    deleteMemory(id, updatedBy, this.isolationContext);
  }

  listAllMemories(projectTags?: string[]) {
    return listMemories(projectTags, this.isolationContext);
  }

  getHighPriorityMemories(projectTags?: string[]) {
    const memories = listMemories(projectTags, this.isolationContext);
    return memories.filter(memory => isHighPriority(memory.priority));
  }

  isMemoryHighPriority(memory: Memory | null): boolean {
    if (!memory) return false;
    return isHighPriority(memory.priority);
  }

  cleanupExpired(): number {
    return cleanupExpiredMemories();
  }

  rebuildSearchIndex(): number {
    return rebuildFullTextIndex();
  }

  isSearchIndexAvailable(): boolean {
    try {
      searchFullText('health-check', 1);
      return true;
    } catch {
      return false;
    }
  }
}

let memoryServiceInstance: MemoryService | null = null;

export function getMemoryService(isolation?: IsolationContext): MemoryService {
  if (!memoryServiceInstance) {
    memoryServiceInstance = new MemoryService(isolation);
  }
  return memoryServiceInstance;
}

export function resetMemoryService(): void {
  memoryServiceInstance = null;
}

export { DEFAULT_ISOLATION };
export type { IsolationContext };
