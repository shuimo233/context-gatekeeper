import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';

const memoryService = getMemoryService();

export const MemoryDeleteBatchInput = z.object({
  memory_ids: z.array(z.string().uuid()).min(1).max(100).describe('Array of memory IDs to delete')
});

export type MemoryDeleteBatchInputType = z.infer<typeof MemoryDeleteBatchInput>;

export async function memoryDeleteBatchTool(input: MemoryDeleteBatchInputType): Promise<{
  deleted: number;
  failed: number;
  total: number;
  failed_ids: string[];
}> {
  let deleted = 0;
  const failedIds: string[] = [];
  
  for (const id of input.memory_ids) {
    try {
      memoryService.removeMemory(id);
      deleted++;
    } catch (error) {
      failedIds.push(id);
    }
  }
  
  return {
    deleted,
    failed: failedIds.length,
    total: input.memory_ids.length,
    failed_ids: failedIds
  };
}
