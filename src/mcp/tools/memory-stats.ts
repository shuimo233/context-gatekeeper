import { getDatabase } from '../../utils/db.js';
import { listMemories, cleanupExpiredMemories } from '../../schema/memory.js';

export interface MemoryStats {
  total_memories: number;
  by_priority: Record<string, number>;
  anchored_count: number;
  avg_content_length: number;
  total_content_tokens: number;
  expired_cleaned: number;
}

export async function memoryStatsTool(): Promise<MemoryStats> {
  // First clean up expired memories
  const expiredCleaned = cleanupExpiredMemories();
  
  void getDatabase(); // Ensure database is initialized
  const memories = listMemories();
  
  // Count by priority
  const byPriority: Record<string, number> = {
    anchored: 0,
    constraint: 0,
    decision: 0,
    preference: 0,
    fact: 0
  };
  
  let totalContentLength = 0;
  let anchoredCount = 0;
  
  for (const memory of memories) {
    byPriority[memory.priority] = (byPriority[memory.priority] || 0) + 1;
    totalContentLength += memory.content.length;
    if (memory.anchored) anchoredCount++;
  }
  
  // Estimate tokens (rough: 4 chars per token)
  const totalTokens = Math.ceil(totalContentLength / 4);
  
  return {
    total_memories: memories.length,
    by_priority: byPriority,
    anchored_count: anchoredCount,
    avg_content_length: memories.length > 0 ? Math.ceil(totalContentLength / memories.length) : 0,
    total_content_tokens: totalTokens,
    expired_cleaned: expiredCleaned
  };
}
