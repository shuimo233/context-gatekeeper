import { z } from 'zod';
import { getThresholdDetector } from '../../services/compressor/threshold.js';

export const MemoryReportUsageInput = z.object({
  used_tokens: z.number().int().nonnegative().describe('Current token usage'),
  max_tokens: z.number().int().positive().describe('Maximum token limit')
});

export type MemoryReportUsageInputType = z.infer<typeof MemoryReportUsageInput>;

export async function memoryReportUsageTool(input: MemoryReportUsageInputType): Promise<{ 
  should_compress: boolean;
  current_ratio: number 
}> {
  const detector = getThresholdDetector();
  const result = detector.reportUsage(input.used_tokens, input.max_tokens);
  
  return {
    should_compress: result.shouldCompress,
    current_ratio: result.currentRatio
  };
}
