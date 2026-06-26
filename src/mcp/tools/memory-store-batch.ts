import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';
import { logger } from '../../utils/logger.js';

const memoryService = getMemoryService();

export const MemoryStoreBatchInput = z.object({
  memories: z.array(z.object({
    content: z.string().describe('The memory content'),
    priority: z.enum(['anchored', 'constraint', 'decision', 'preference', 'fact']).describe('Priority level'),
    project_tags: z.array(z.string()).optional().describe('Project tags'),
    anchored: z.boolean().optional().describe('Whether this memory is anchored'),
    expires_in_hours: z.number().positive().optional().describe('TTL in hours')
  })).min(1).max(100).describe('Array of memories to store')
});

export type MemoryStoreBatchInputType = z.infer<typeof MemoryStoreBatchInput>;

export async function memoryStoreBatchTool(input: MemoryStoreBatchInputType): Promise<{
  stored: Array<{ id: string; content: string; priority: string }>;
  duplicates: number;
  total: number;
}> {
  const stored: Array<{ id: string; content: string; priority: string }> = [];
  let duplicates = 0;
  
  for (const mem of input.memories) {
    try {
      // Calculate expiresAt if TTL is provided
      let expiresAt: Date | undefined;
      if (mem.expires_in_hours) {
        expiresAt = new Date(Date.now() + mem.expires_in_hours * 60 * 60 * 1000);
      }
      
      const memory = await memoryService.storeMemory({
        content: mem.content,
        priority: mem.priority as any,
        projectTags: mem.project_tags,
        anchored: mem.anchored,
        expiresAt
      });
      
      stored.push({
        id: memory.id,
        content: memory.content.substring(0, 50) + (memory.content.length > 50 ? '...' : ''),
        priority: memory.priority
      });
    } catch (error) {
      logger.error('Failed to store memory in batch', { error: error instanceof Error ? error.message : String(error) });
      duplicates++;
    }
  }
  
  return {
    stored,
    duplicates,
    total: input.memories.length
  };
}
