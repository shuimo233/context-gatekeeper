import { z } from 'zod';
import { configureLLM, getLLMConfig, isLLMAvailable } from '../../services/llm.js';

export const ConfigureLLMInput = z.object({
  provider: z.enum(['openai', 'ollama', 'anthropic', 'none']).optional().describe('LLM provider'),
  api_key: z.string().optional().describe('API key (or set OPENAI_API_KEY env var)'),
  base_url: z.string().optional().describe('Base URL for API (optional)'),
  model: z.string().optional().describe('Model name (e.g., gpt-3.5-turbo, llama3.2)')
});

export type ConfigureLLMInputType = z.infer<typeof ConfigureLLMInput>;

export async function configureLLMTool(input: ConfigureLLMInputType): Promise<{
  success: boolean;
  provider: string;
  model: string;
  llm_available: boolean;
  message: string;
}> {
  const newConfig: Record<string, string> = {};
  
  if (input.provider) newConfig.provider = input.provider;
  if (input.api_key) newConfig.apiKey = input.api_key;
  if (input.base_url) newConfig.baseUrl = input.base_url;
  if (input.model) newConfig.model = input.model;
  
  configureLLM(newConfig as any);
  
  const config = getLLMConfig();
  const llmAvailable = await isLLMAvailable();
  
  return {
    success: true,
    provider: config.provider,
    model: config.model,
    llm_available: llmAvailable,
    message: llmAvailable 
      ? `${config.provider} configured successfully, LLM is available`
      : `${config.provider} configured, LLM not available (check API key or connection)`
  };
}
