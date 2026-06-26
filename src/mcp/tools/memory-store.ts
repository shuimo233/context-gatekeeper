import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';

const memoryService = getMemoryService();

export const MemoryStoreInput = z.object({
  content: z.string().min(1).describe('The memory content'),
  priority: z.enum(['anchored', 'constraint', 'decision', 'preference', 'fact']).describe('Priority level'),
  project_tags: z.array(z.string()).optional().describe('Project tags for filtering'),
  anchored: z.boolean().optional().describe('Whether this memory is anchored (permanent)'),
  expires_in_hours: z.number().positive().optional().describe('TTL in hours'),
  updated_by: z.string().optional().describe('Source that updated this memory'),
  // Storage isolation fields
  user_id: z.string().optional().default('default').describe('User ID for isolation'),
  agent_id: z.string().optional().default('default').describe('Agent ID for isolation'),
  project_id: z.string().optional().default('default').describe('Project ID for isolation')
});

export type MemoryStoreInputType = z.infer<typeof MemoryStoreInput>;

export async function memoryStoreTool(input: MemoryStoreInputType): Promise<{ id: string }> {
  // Calculate expiresAt if TTL is provided
  let expiresAt: Date | undefined;
  if (input.expires_in_hours) {
    expiresAt = new Date(Date.now() + input.expires_in_hours * 60 * 60 * 1000);
  }
  
  const memory = await memoryService.storeMemory({
    content: input.content,
    priority: input.priority,
    projectTags: input.project_tags,
    anchored: input.anchored,
    expiresAt,
    userId: input.user_id,
    agentId: input.agent_id,
    projectId: input.project_id
  }, input.updated_by);
  
  return { id: memory.id };
}
