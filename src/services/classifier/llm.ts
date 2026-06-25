import { Memory } from '../../models/types.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export interface LLMConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface ClassifierResult {
  memoryId: string;
  relevance: number;
}

/**
 * Build the prompt for LLM-based memory classification
 */
function buildClassificationPrompt(
  userInput: string,
  memories: Memory[]
): string {
  const memoryList = memories
    .map(m => `- [${m.id}] (${m.priority}${m.anchored ? ', anchored' : ''}): ${m.content}`)
    .join('\n');
  
  return `Given the following user input and available memories, identify which memories are relevant to inject into the context.

User Input:
${userInput}

Available Memories:
${memoryList}

Respond with a JSON array of memory IDs that should be injected, ordered by relevance (most relevant first).
Format: ["memory-id-1", "memory-id-2", ...]
If no memories are relevant, respond with an empty array: []
Only respond with the JSON array, nothing else.`;
}

/**
 * Default LLM classifier using the agent's own model
 * This can be overridden by user configuration
 */
export class LLMClassifier {
  private config: LLMConfig;
  
  constructor(config: LLMConfig = {}) {
    this.config = {
      model: 'gpt-4o',
      ...config
    };
  }
  
  /**
   * Configure the LLM settings
   */
  configure(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Classify memories using LLM
   * Returns memory IDs with relevance scores
   */
  async classify(
    userInput: string,
    memories: Memory[]
  ): Promise<ClassifierResult[]> {
    if (memories.length === 0) {
      return [];
    }
    
    const prompt = buildClassificationPrompt(userInput, memories);
    
    try {
      const response = await this.callLLM(prompt);
      const memoryIds = this.parseLLMResponse(response);
      
      // Calculate relevance scores (uniform initially, could be refined)
      return memoryIds.map(id => ({ memoryId: id, relevance: 1.0 }));
    } catch (error) {
      // Don't throw - let the fallback handle it
      logger.error('LLM classification failed', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
  
  /**
   * Call the LLM API
   */
  private async callLLM(prompt: string): Promise<string> {
    const { apiKey, baseUrl, model } = this.config;
    
    // If no API key is configured, we can't make the call
    if (!apiKey) {
      throw new LLMError('No LLM API key configured');
    }
    
    const url = baseUrl || 'https://api.openai.com/v1/chat/completions';
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      throw new LLMError(`LLM API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content || '[]';
  }
  
  /**
   * Parse LLM response to extract memory IDs
   */
  private parseLLMResponse(response: string): string[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as string[];
      }
      return [];
    } catch {
      return [];
    }
  }
}

// Singleton instance
let llmClassifierInstance: LLMClassifier | null = null;

export function getLLMClassifier(config?: LLMConfig): LLMClassifier {
  if (!llmClassifierInstance) {
    llmClassifierInstance = new LLMClassifier(config);
  } else if (config) {
    llmClassifierInstance.configure(config);
  }
  return llmClassifierInstance;
}
