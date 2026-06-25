import { z } from 'zod';
import { getContextCompressor } from '../../services/compressor/trigger.js';

export const ContextCompressInput = z.object({
  target_ratio: z.number().min(0).max(1).optional().describe('Target compression ratio (0-1)')
});

export type ContextCompressInputType = z.infer<typeof ContextCompressInput>;

export async function contextCompressTool(input: ContextCompressInputType): Promise<{
  id: string;
  compressed_count: number;
  remaining_ratio: number
}> {
  const compressor = getContextCompressor();
  const result = await compressor.compress(input.target_ratio);
  
  return {
    id: result.id,
    compressed_count: result.compressedCount,
    remaining_ratio: result.remainingRatio
  };
}
