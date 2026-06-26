/**
 * Reranker Service
 * Implements two-stage retrieval: recall candidates, then rerank with scoring
 */

import { Memory, IsolationContext } from '../models/types.js';
import { searchMemoriesVector, searchMemoriesHybrid, searchMemoriesBM25, listMemories } from '../schema/memory.js';
import { getCurrentProvider } from './embedding-provider.js';
import { isHighPriority } from '../utils/priority.js';

export interface RerankConfig {
  initialRecallLimit: number;
  finalLimit: number;
  rerankWeight: {
    semantic: number;
    keyword: number;
    recency: number;
    importance: number;
  };
  importanceThreshold: number;
}

const DEFAULT_RERANK_CONFIG: RerankConfig = {
  initialRecallLimit: 50,
  finalLimit: 10,
  rerankWeight: {
    semantic: 0.4,
    keyword: 0.3,
    recency: 0.2,
    importance: 0.1
  },
  importanceThreshold: 0.5
};

export interface RerankedResult {
  memory: Memory;
  originalScore: number;
  rerankedScore: number;
  rerankFactors: {
    semanticScore: number;
    keywordScore: number;
    recencyScore: number;
    importanceScore: number;
  };
}

export interface RerankedSearchResult {
  results: RerankedResult[];
  totalCandidates: number;
  searchMode: string;
}

class RerankerService {
  private config: RerankConfig;

  constructor(config: Partial<RerankConfig> = {}) {
    this.config = { ...DEFAULT_RERANK_CONFIG, ...config };
  }

  /**
   * Two-stage retrieval with reranking
   */
  async search(
    query: string,
    isolation?: IsolationContext,
    projectTags?: string[],
    mode: 'semantic' | 'keyword' | 'hybrid' = 'hybrid'
  ): Promise<RerankedSearchResult> {
    const candidates = await this.recallCandidates(query, isolation, projectTags, mode);
    const reranked = await this.rerank(query, candidates, isolation);

    return {
      results: reranked.slice(0, this.config.finalLimit),
      totalCandidates: candidates.length,
      searchMode: mode
    };
  }

  /**
   * Stage 1: Recall candidates using multiple strategies
   */
  private async recallCandidates(
    query: string,
    isolation?: IsolationContext,
    projectTags?: string[],
    mode: 'semantic' | 'keyword' | 'hybrid' = 'hybrid'
  ): Promise<Memory[]> {
    const candidates: Map<string, Memory & { originalScore: number }> = new Map();
    const limit = this.config.initialRecallLimit;

    const provider = getCurrentProvider();

    if (mode === 'semantic' || mode === 'hybrid') {
      try {
        const result = await provider.embed(query);
        const semanticResults = searchMemoriesVector(
          result.vector,
          projectTags,
          limit,
          0.05,
          isolation
        );

        for (const r of semanticResults) {
          candidates.set(r.id, { ...r, originalScore: r.similarity });
        }
      } catch {
        // Fallback to other methods
      }
    }

    if (mode === 'keyword' || mode === 'hybrid') {
      const keywordResults = searchMemoriesBM25(
        query,
        projectTags,
        limit,
        isolation
      );

      for (const memory of keywordResults) {
        if (!candidates.has(memory.id)) {
          candidates.set(memory.id, { ...memory, originalScore: 0.5 });
        }
      }
    }

    if (mode === 'hybrid') {
      try {
        const result = await provider.embed(query);
        const hybridResults = searchMemoriesHybrid(
          query,
          result.vector,
          projectTags,
          limit,
          0.5,
          0.5,
          isolation
        );

        for (const r of hybridResults) {
          if (!candidates.has(r.id)) {
            candidates.set(r.id, { ...r, originalScore: r.combinedScore });
          }
        }
      } catch {
        // Ignore
      }
    }

    const allMemories = listMemories(projectTags, isolation);
    const anchoredHighPriority = allMemories.filter(m => m.anchored || isHighPriority(m.priority));

    for (const memory of anchoredHighPriority) {
      if (!candidates.has(memory.id)) {
        candidates.set(memory.id, { ...memory, originalScore: 0.9 });
      }
    }

    return Array.from(candidates.values());
  }

  /**
   * Stage 2: Rerank candidates using multiple signals
   */
  private async rerank(
    query: string,
    candidates: Memory[],
    _isolation?: IsolationContext
  ): Promise<RerankedResult[]> {
    const provider = getCurrentProvider();
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    const queryResult = await provider.embed(query);
    const queryEmbedding = queryResult.vector;

    const memoryEmbeddings = new Map<string, number[]>();
    await Promise.all(
      candidates.map(async (m) => {
        const r = await provider.embed(m.content);
        memoryEmbeddings.set(m.id, r.vector);
      })
    );

    const reranked: RerankedResult[] = [];

    for (const candidate of candidates) {
      const memoryEmbedding = memoryEmbeddings.get(candidate.id);
      const factors = this.computeRerankFactors(
        candidate,
        queryTerms,
        queryEmbedding,
        memoryEmbedding ?? null
      );
      const rerankedScore = this.computeFinalScore(factors);

      reranked.push({
        memory: candidate,
        originalScore: 'originalScore' in candidate ? (candidate as Memory & { originalScore: number }).originalScore : 0.5,
        rerankedScore,
        rerankFactors: factors
      });
    }

    reranked.sort((a, b) => b.rerankedScore - a.rerankedScore);

    return reranked;
  }

  /**
   * Compute individual reranking factors
   */
  private computeRerankFactors(
    memory: Memory,
    queryTerms: string[],
    queryEmbedding: number[],
    memoryEmbedding: number[] | null
  ): RerankedResult['rerankFactors'] {
    const semanticScore = this.computeSemanticScore(memoryEmbedding, queryEmbedding);
    const keywordScore = this.computeKeywordScore(memory.content, queryTerms);
    const recencyScore = this.computeRecencyScore(memory.updatedAt);
    const importanceScore = this.computeImportanceScore(memory);

    return {
      semanticScore,
      keywordScore,
      recencyScore,
      importanceScore
    };
  }

  /**
   * Compute semantic similarity score
   */
  private computeSemanticScore(
    memoryEmbedding: number[] | null,
    queryEmbedding: number[]
  ): number {
    if (!memoryEmbedding) return 0;

    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(memoryEmbedding.length, queryEmbedding.length);
    for (let i = 0; i < len; i++) {
      dot += memoryEmbedding[i] * queryEmbedding[i];
      normA += memoryEmbedding[i] * memoryEmbedding[i];
      normB += queryEmbedding[i] * queryEmbedding[i];
    }

    const cosine = normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
    return Math.max(0, Math.min(1, cosine));
  }

  /**
   * Compute keyword match score
   */
  private computeKeywordScore(content: string, queryTerms: string[]): number {
    if (queryTerms.length === 0) return 0.5;

    const contentLower = content.toLowerCase();
    let matches = 0;

    for (const term of queryTerms) {
      if (contentLower.includes(term)) {
        matches++;
      }
    }

    return matches / queryTerms.length;
  }

  /**
   * Compute recency score (exponential decay)
   */
  private computeRecencyScore(updatedAt: Date): number {
    const now = new Date();
    const ageMs = now.getTime() - updatedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    const halfLifeDays = 7;
    const decay = Math.pow(0.5, ageDays / halfLifeDays);

    return Math.max(0.1, Math.min(1, decay));
  }

  /**
   * Compute importance score
   */
  private computeImportanceScore(memory: Memory): number {
    const priorityScore: Record<string, number> = {
      anchored: 1.0,
      constraint: 0.9,
      decision: 0.7,
      preference: 0.5,
      fact: 0.3
    };

    const baseScore = priorityScore[memory.priority] ?? 0.5;
    const anchoredBoost = memory.anchored ? 0.1 : 0;
    const accessBoost = Math.min(0.2, Math.log10(memory.accessCount + 1) * 0.1);

    return Math.min(1, baseScore + anchoredBoost + accessBoost);
  }

  /**
   * Compute final score from factors
   */
  private computeFinalScore(factors: RerankedResult['rerankFactors']): number {
    const { semantic, keyword, recency, importance } = this.config.rerankWeight;

    return (
      factors.semanticScore * semantic +
      factors.keywordScore * keyword +
      factors.recencyScore * recency +
      factors.importanceScore * importance
    );
  }

  /**
   * Filter results by importance threshold
   */
  filterByImportance(results: RerankedResult[]): RerankedResult[] {
    return results.filter(r => r.rerankFactors.importanceScore >= this.config.importanceThreshold);
  }

  /**
   * Get configuration
   */
  getConfig(): RerankConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<RerankConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ============ Singleton ============

let rerankerInstance: RerankerService | null = null;

export function getRerankerService(config?: Partial<RerankConfig>): RerankerService {
  if (!rerankerInstance) {
    rerankerInstance = new RerankerService(config);
  }
  return rerankerInstance;
}

export function resetRerankerService(): void {
  rerankerInstance = null;
}
