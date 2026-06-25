import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';

const memoryService = getMemoryService();

export const MemoryAnchorInput = z.object({
  memory_id: z.string().describe('The memory ID to anchor')
});

export type MemoryAnchorInputType = z.infer<typeof MemoryAnchorInput>;

export async function memoryAnchorTool(input: MemoryAnchorInputType): Promise<{ success: boolean }> {
  try {
    memoryService.anchorMemory(input.memory_id);
    return { success: true };
  } catch (error) {
    return { success: false };
  }
}
