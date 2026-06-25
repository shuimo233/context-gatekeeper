/**
 * LLM Summarization Service
 * Provides automatic summarization using configurable LLM providers
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'ollama', 'anthropic', 'none']).default('none'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().default('gpt-3.5-turbo')
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

// Global config
let config: LLMConfig = {
  provider: 'none',
  model: 'gpt-3.5-turbo'
};

/**
 * Configure the LLM provider
 */
export function configureLLM(newConfig: Partial<LLMConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Get current LLM config
 */
export function getLLMConfig(): LLMConfig {
  return { ...config };
}

/**
 * Summarize content using configured LLM
 */
export async function summarizeContent(content: string, maxLength: number = 200): Promise<string> {
  // If no LLM configured, use simple truncation
  if (config.provider === 'none') {
    return simpleSummarize(content, maxLength);
  }

  try {
    switch (config.provider) {
      case 'openai':
        return await summarizeWithOpenAI(content, maxLength);
      case 'ollama':
        return await summarizeWithOllama(content, maxLength);
      case 'anthropic':
        return await summarizeWithAnthropic(content, maxLength);
      default:
        return simpleSummarize(content, maxLength);
    }
  } catch (error) {
    logger.error('LLM summarization failed, falling back to simple', { error: error instanceof Error ? error.message : String(error) });
    return simpleSummarize(content, maxLength);
  }
}

/**
 * Simple extractive summarization (no LLM required)
 */
function simpleSummarize(content: string, maxLength: number = 200): string {
  if (content.length <= maxLength) {
    return content;
  }

  // Try to find sentence boundaries
  const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
  let result = '';
  
  for (const sentence of sentences) {
    if (result.length + sentence.length > maxLength) {
      break;
    }
    result += sentence;
  }

  // If no sentences fit, truncate with word boundary
  if (!result) {
    const words = content.split(/\s+/);
    result = words.slice(0, Math.floor(maxLength / 5)).join(' ') + '...';
  }

  return result.trim() || content.substring(0, maxLength - 3) + '...';
}

/**
 * Summarize using OpenAI API
 */
async function summarizeWithOpenAI(content: string, maxLength: number): Promise<string> {
  const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return simpleSummarize(content, maxLength);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content: `You are a text summarizer. Summarize the following content in no more than ${maxLength} characters. Keep the key information and essential meaning.`
        },
        {
          role: 'user',
          content
        }
      ],
      max_tokens: Math.ceil(maxLength / 2),
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || simpleSummarize(content, maxLength);
}

/**
 * Summarize using Ollama (local LLM)
 */
async function summarizeWithOllama(content: string, maxLength: number): Promise<string> {
  const baseUrl = config.baseUrl || 'http://localhost:11434/api/generate';
  
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model || 'llama3.2',
      prompt: `Summarize this in ${maxLength} characters or less:\n\n${content}`,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = await response.json() as { response?: string };
  return data.response?.trim() || simpleSummarize(content, maxLength);
}

/**
 * Summarize using Anthropic API
 */
async function summarizeWithAnthropic(content: string, maxLength: number): Promise<string> {
  const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return simpleSummarize(content, maxLength);
  }

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model || 'claude-3-haiku',
      max_tokens: Math.ceil(maxLength / 2),
      messages: [
        {
          role: 'user',
          content: `Summarize this in ${maxLength} characters or less: ${content}`
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text?.trim() || simpleSummarize(content, maxLength);
}

/**
 * Check if LLM is available (for health check)
 */
export async function isLLMAvailable(): Promise<boolean> {
  if (config.provider === 'none') {
    return false;
  }

  try {
    switch (config.provider) {
      case 'openai': {
        const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) return false;
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        return response.ok;
      }
      case 'ollama': {
        const baseUrl = config.baseUrl || 'http://localhost:11434';
        const response = await fetch(`${baseUrl}/api/tags`);
        return response.ok;
      }
      case 'anthropic': {
        const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return false;
        return true; // Assume available if key is set
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}
