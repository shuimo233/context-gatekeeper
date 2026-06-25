/**
 * Embedding Provider 抽象接口
 *
 * 支持多种 embedding 后端：
 * - tfidf: 零依赖 TF-IDF（默认降级）
 * - openai: OpenAI text-embedding-3-small/ada-002
 * - cohere: Cohere Embed v3/v4
 * - ollama: 本地 Ollama embedding 模型
 */

export interface EmbeddingResult {
  vector: number[];
  dimension: number;
  model: string;
  provider: string;
}

export interface EmbeddingProvider {
  /** Provider 名称 */
  readonly name: string;

  /** 生成文本的 embedding 向量 */
  embed(content: string): Promise<EmbeddingResult>;

  /** 批量生成 embedding */
  embedBatch(contents: string[]): Promise<EmbeddingResult[]>;

  /** 向量维度 */
  readonly dimension: number;

  /** 是否可用（已配置） */
  isAvailable(): boolean;
}

// ============================================================
// TF-IDF Provider（零依赖降级）
// ============================================================

import { generateFixedEmbedding, FIXED_EMBEDDING_DIMENSION } from './embedding-fixed.js';

export class TfidfEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'tfidf';
  readonly dimension = FIXED_EMBEDDING_DIMENSION;

  private corpus: string[] = [];

  embed(content: string): Promise<EmbeddingResult> {
    const vector = generateFixedEmbedding(content, this.corpus);
    this.corpus.push(content);
    return Promise.resolve({ vector, dimension: this.dimension, model: 'fixed-tfidf', provider: 'tfidf' });
  }

  embedBatch(contents: string[]): Promise<EmbeddingResult[]> {
    const results = contents.map(content => {
      const vector = generateFixedEmbedding(content, this.corpus);
      this.corpus.push(content);
      return { vector, dimension: this.dimension, model: 'fixed-tfidf', provider: 'tfidf' as const };
    });
    return Promise.resolve(results);
  }

  isAvailable(): boolean {
    return true; // 始终可用
  }

  /** 更新语料库（用于增量索引） */
  addToCorpus(content: string): void {
    this.corpus.push(content);
  }

  /** 清空语料库 */
  clearCorpus(): void {
    this.corpus = [];
  }
}

// ============================================================
// OpenAI Provider
// ============================================================

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimension: number;
  readonly model: string;

  private apiKey: string;
  private baseUrl: string;

  constructor(model = 'text-embedding-3-small', dimension = 1536) {
    this.model = model;
    this.dimension = dimension;
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.baseUrl = process.env.OPENAI_EMBEDDING_BASE_URL || 'https://api.openai.com/v1';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  async embed(content: string): Promise<EmbeddingResult> {
    if (!this.isAvailable()) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: content,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.status}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    const vector = data.data[0]?.embedding ?? new Array(this.dimension).fill(0);

    return { vector, dimension: vector.length, model: this.model, provider: 'openai' };
  }

  async embedBatch(contents: string[]): Promise<EmbeddingResult[]> {
    if (!this.isAvailable()) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: contents,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding error: ${response.status}`);
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(item => ({
      vector: item.embedding,
      dimension: item.embedding.length,
      model: this.model,
      provider: 'openai',
    }));
  }
}

// ============================================================
// Cohere Provider
// ============================================================

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'cohere';
  readonly dimension = 1024;
  readonly model = 'embed-english-v3.0';

  private apiKey: string;

  constructor() {
    this.apiKey = process.env.COHERE_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async embed(content: string): Promise<EmbeddingResult> {
    if (!this.isAvailable()) {
      throw new Error('Cohere API key not configured');
    }

    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        texts: [content],
        model: this.model,
        input_type: 'search_document',
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere embedding error: ${response.status}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return {
      vector: data.embeddings[0] ?? new Array(this.dimension).fill(0),
      dimension: this.dimension,
      model: this.model,
      provider: 'cohere',
    };
  }

  async embedBatch(contents: string[]): Promise<EmbeddingResult[]> {
    if (!this.isAvailable()) {
      throw new Error('Cohere API key not configured');
    }

    const response = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        texts: contents,
        model: this.model,
        input_type: 'search_document',
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere embedding error: ${response.status}`);
    }

    const data = await response.json() as { embeddings: number[][] };
    return data.embeddings.map(vector => ({
      vector,
      dimension: vector.length,
      model: this.model,
      provider: 'cohere',
    }));
  }
}

// ============================================================
// Provider 注册中心
// ============================================================

export type EmbeddingProviderName = 'tfidf' | 'openai' | 'cohere' | 'ollama';

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  openaiApiKey?: string;
  cohereApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
}

let currentProvider: EmbeddingProvider = new TfidfEmbeddingProvider();
let currentConfig: EmbeddingConfig = { provider: 'tfidf' };

export function configureEmbeddingProvider(config: EmbeddingConfig): void {
  currentConfig = config;

  switch (config.provider) {
    case 'openai': {
      const provider = new OpenAIEmbeddingProvider(
        config.openaiModel || 'text-embedding-3-small',
        config.openaiModel === 'text-embedding-3-large' ? 3072 : 1536
      );
      if (config.openaiApiKey) provider.setApiKey(config.openaiApiKey);
      if (config.openaiBaseUrl) provider.setBaseUrl(config.openaiBaseUrl);
      currentProvider = provider;
      break;
    }
    case 'cohere': {
      const provider = new CohereEmbeddingProvider();
      if (config.cohereApiKey) provider.setApiKey(config.cohereApiKey);
      currentProvider = provider;
      break;
    }
    case 'tfidf':
    default:
      currentProvider = new TfidfEmbeddingProvider();
      break;
  }
}

export function getCurrentProvider(): EmbeddingProvider {
  return currentProvider;
}

export function getEmbeddingConfig(): EmbeddingConfig {
  return { ...currentConfig };
}

/** 获取当前 provider 的便捷函数 */
export async function generateEmbedding(content: string): Promise<EmbeddingResult> {
  return currentProvider.embed(content);
}

/** 批量生成 embedding */
export async function generateEmbeddingBatch(contents: string[]): Promise<EmbeddingResult[]> {
  return currentProvider.embedBatch(contents);
}
