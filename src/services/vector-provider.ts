/**
 * DEPRECATED — use services/embedding-provider.ts instead.
 * This module is kept for backward compatibility and is not used by the current codebase.
 *
 * Vector provider abstraction for external embedding services
 * Supports multiple backends: local (TF-IDF), OpenAI, Ollama, Anthropic
 *
 * NOTE: dimension mismatch risk — LocalVectorProvider uses VECTOR_DIM (128)
 * from embedding.ts, but memory.ts stores embeddings at 4096-dim (embedding-fixed).
 * Do not use this module for new code.
 */

import { VECTOR_DIM } from './embedding.js';

export type VectorProviderType = 'local' | 'openai' | 'ollama' | 'anthropic';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
  provider: VectorProviderType;
}

export interface VectorProviderConfig {
  provider: VectorProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimension?: number;
}

export interface VectorProvider {
  readonly type: VectorProviderType;
  readonly model: string;
  readonly dimension: number;
  
  /**
   * Generate embedding for a single text
   */
  embed(text: string): Promise<EmbeddingResult>;
  
  /**
   * Generate embeddings for multiple texts (batch)
   */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  
  /**
   * Check if the provider is available/healthy
   */
  healthCheck(): Promise<boolean>;
}

let currentProvider: VectorProvider | null = null;
let currentConfig: VectorProviderConfig | null = null;

export function getCurrentProvider(): VectorProvider | null {
  return currentProvider;
}

export function getCurrentConfig(): VectorProviderConfig | null {
  return currentConfig;
}

export function configureProvider(config: VectorProviderConfig): VectorProvider {
  const { provider, apiKey, baseUrl, model, dimension } = config;
  
  switch (provider) {
    case 'local':
      currentProvider = new LocalVectorProvider(model, dimension);
      break;
    case 'openai':
      currentProvider = new OpenAIVectorProvider(apiKey!, baseUrl, model || 'text-embedding-3-small', dimension);
      break;
    case 'ollama':
      currentProvider = new OllamaVectorProvider(baseUrl || 'http://localhost:11434', model || 'nomic-embed-text', dimension);
      break;
    case 'anthropic':
      currentProvider = new AnthropicVectorProvider(apiKey!, model, dimension);
      break;
    default:
      throw new Error(`Unknown vector provider: ${provider}`);
  }
  
  currentConfig = config;
  return currentProvider;
}

// ============ Local (TF-IDF) Provider ============

class LocalVectorProvider implements VectorProvider {
  readonly type: VectorProviderType = 'local';
  readonly model: string;
  readonly dimension: number;
  
  constructor(model: string = 'local-tfidf', dimension: number = VECTOR_DIM) {
    this.model = model;
    this.dimension = dimension;
  }
  
  async embed(text: string): Promise<EmbeddingResult> {
    const { generateEmbedding } = await import('./embedding.js');
    return {
      embedding: generateEmbedding(text),
      model: this.model,
      dimension: this.dimension,
      provider: 'local'
    };
  }
  
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const { generateEmbedding } = await import('./embedding.js');
    return texts.map(text => ({
      embedding: generateEmbedding(text, texts),
      model: this.model,
      dimension: this.dimension,
      provider: 'local' as VectorProviderType
    }));
  }
  
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ============ OpenAI Provider ============

class OpenAIVectorProvider implements VectorProvider {
  readonly type: VectorProviderType = 'openai';
  readonly model: string;
  readonly dimension: number;
  private apiKey: string;
  private baseUrl: string;
  
  constructor(apiKey: string, baseUrl?: string, model: string = 'text-embedding-3-small', dimension: number = 1536) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || 'https://api.openai.com/v1';
    this.model = model;
    this.dimension = dimension;
  }
  
  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        input: text,
        model: this.model
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data[0]?.embedding || new Array(this.dimension).fill(0);
    
    return {
      embedding,
      model: this.model,
      dimension: embedding.length,
      provider: 'openai'
    };
  }
  
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        input: texts,
        model: this.model
      })
    });
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }
    
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    
    return data.data.map(item => ({
      embedding: item.embedding,
      model: this.model,
      dimension: item.embedding.length,
      provider: 'openai' as VectorProviderType
    }));
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============ Ollama Provider ============

class OllamaVectorProvider implements VectorProvider {
  readonly type: VectorProviderType = 'ollama';
  readonly model: string;
  readonly dimension: number;
  private baseUrl: string;
  
  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text', dimension: number = 768) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.dimension = dimension;
  }
  
  async embed(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: text
      })
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const data = await response.json() as { embedding: number[] };
    
    return {
      embedding: data.embedding,
      model: this.model,
      dimension: data.embedding.length,
      provider: 'ollama'
    };
  }
  
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    
    return results;
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============ Anthropic Provider ============

class AnthropicVectorProvider implements VectorProvider {
  readonly type: VectorProviderType = 'anthropic';
  readonly model: string;
  readonly dimension: number;
  
  constructor(_apiKey: string, model: string = 'claude-3-5-sonnet-20241022', dimension: number = 1024) {
    this.model = model;
    this.dimension = dimension;
  }
  
  async embed(_text: string): Promise<EmbeddingResult> {
    // Anthropic doesn't have a public embeddings API yet
    // Fall back to local provider
    const { generateEmbedding } = await import('./embedding.js');
    return {
      embedding: generateEmbedding(_text),
      model: 'anthropic-fallback',
      dimension: this.dimension,
      provider: 'local'
    };
  }
  
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
  
  async healthCheck(): Promise<boolean> {
    // Anthropic doesn't have embeddings API, so always returns false for direct use
    return false;
  }
}

// ============ Default Provider ============

export function getDefaultProvider(): VectorProvider {
  if (!currentProvider) {
    currentProvider = new LocalVectorProvider();
  }
  return currentProvider;
}
