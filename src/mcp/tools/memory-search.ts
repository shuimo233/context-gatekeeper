import { z } from 'zod';
import { getMemoryService, SearchMode } from '../../services/memory.js';

const memoryService = getMemoryService();

export const MemorySearchInput = z.object({
  query: z.string().describe('Search query'),
  project_tags: z.array(z.string()).optional().describe('Filter by project tags'),
  limit: z.number().int().positive().optional().default(10).describe('Maximum number of results'),
  search_mode: z.enum(['keyword', 'semantic', 'hybrid', 'auto']).optional().default('auto').describe('Search mode: keyword (BM25), semantic (vector), hybrid (both), or auto (detect)'),
  // Storage isolation fields
  user_id: z.string().optional().default('default').describe('User ID for isolation'),
  agent_id: z.string().optional().default('default').describe('Agent ID for isolation'),
  project_id: z.string().optional().default('default').describe('Project ID for isolation')
});

export type MemorySearchInputType = z.infer<typeof MemorySearchInput>;

export interface MemorySearchOutput {
  memories: Array<{
    id: string;
    content: string;
    priority: string;
    project_tags: string[];
    anchored: boolean;
    access_count: number;
    created_at: string;
    updated_at: string;
  }>;
  search_mode: string;
  total: number;
}

export async function memorySearchTool(input: MemorySearchInputType): Promise<MemorySearchOutput> {
  const memories = memoryService.recallMemories(
    {
      query: input.query,
      projectTags: input.project_tags,
      limit: input.limit,
      userId: input.user_id,
      agentId: input.agent_id,
      projectId: input.project_id
    },
    input.search_mode as SearchMode
  );

  return {
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      priority: m.priority,
      project_tags: m.projectTags,
      anchored: m.anchored,
      access_count: m.accessCount,
      created_at: m.createdAt.toISOString(),
      updated_at: m.updatedAt.toISOString()
    })),
    search_mode: input.search_mode,
    total: memories.length
  };
}
