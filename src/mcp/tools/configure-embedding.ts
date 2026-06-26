import { z } from 'zod';
import {
  configureEmbeddingProvider,
  getEmbeddingConfig,
  getCurrentProvider,
  type EmbeddingProviderName,
} from '../../services/embedding-provider.js';

export const ConfigureEmbeddingInput = z.object({
  provider: z.enum(['tfidf', 'openai', 'cohere', 'ollama'])
    .optional()
    .describe('Embedding provider: tfidf (zero-dependency, default), openai, cohere, ollama'),
  openai_api_key: z.string().optional().describe('OpenAI API key (or set OPENAI_API_KEY env var)'),
  openai_model: z.string().optional().describe('OpenAI embedding model (e.g., text-embedding-3-small, text-embedding-3-large)'),
  openai_base_url: z.string().optional().describe('Custom OpenAI-compatible base URL (e.g., for Azure or local proxies)'),
  cohere_api_key: z.string().optional().describe('Cohere API key (or set COHERE_API_KEY env var)'),
});

export type ConfigureEmbeddingInputType = z.infer<typeof ConfigureEmbeddingInput>;

export interface ConfigureEmbeddingOutput {
  success: boolean;
  provider: EmbeddingProviderName;
  dimension: number;
  available: boolean;
  model: string;
  warning: string | null;
}

export async function configureEmbeddingTool(input: ConfigureEmbeddingInputType): Promise<ConfigureEmbeddingOutput> {
  const config: Parameters<typeof configureEmbeddingProvider>[0] = {
    provider: input.provider ?? 'tfidf',
  };

  if (input.openai_api_key) config.openaiApiKey = input.openai_api_key;
  if (input.openai_model) config.openaiModel = input.openai_model;
  if (input.openai_base_url) config.openaiBaseUrl = input.openai_base_url;
  if (input.cohere_api_key) config.cohereApiKey = input.cohere_api_key;

  configureEmbeddingProvider(config);

  const provider = getCurrentProvider();
  const cfg = getEmbeddingConfig();

  let warning: string | null = null;
  if (cfg.provider !== 'tfidf' && !provider.isAvailable()) {
    warning =
      `Provider "${cfg.provider}" requires an API key. ` +
      `Set the appropriate environment variable (OPENAI_API_KEY / COHERE_API_KEY) or pass the key directly.`;
  } else if (cfg.provider === 'tfidf') {
    warning = null;
  }

  return {
    success: true,
    provider: cfg.provider,
    dimension: provider.dimension,
    available: provider.isAvailable(),
    model: provider.name,
    warning,
  };
}
