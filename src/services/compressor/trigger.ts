import { Memory, CompressionResult } from '../../models/types.js';
import { listMemories, updateMemory } from '../../schema/memory.js';
import { createCompression } from '../../schema/compression.js';
import { calculatePriorityScore } from '../../utils/priority.js';
import { logger } from '../../utils/logger.js';

/**
 * Context compressor - handles context compression logic
 */
export class ContextCompressor {
  /**
   * Compress context to target ratio
   */
  async compress(targetRatio: number = 0.6): Promise<CompressionResult> {
    // Get all non-deleted, non-anchored memories
    const memories = listMemories().filter(m => !m.deleted && !m.anchored);
    
    // Calculate scores for all memories
    const scoredMemories = memories.map(memory => ({
      memory,
      score: calculatePriorityScore(
        memory.priority,
        memory.accessCount,
        memory.createdAt,
        memory.anchored
      )
    }));
    
    // Sort by score (ascending - lower scores are candidates for compression)
    scoredMemories.sort((a, b) => a.score - b.score);
    
    // Select memories to compress (keep high-priority ones)
    const toCompress: Memory[] = [];
    let currentRatio = 1.0;
    
    for (const { memory } of scoredMemories) {
      if (currentRatio <= targetRatio) break;
      if (!memory.anchored && memory.priority !== 'anchored' && memory.priority !== 'constraint') {
        toCompress.push(memory);
        currentRatio -= 0.1;
      }
    }
    
    // Perform compression (create compression records)
    let compressedCount = 0;
    
    for (const memory of toCompress) {
      try {
        await this.compressMemory(memory);
        compressedCount++;
      } catch (error) {
        logger.error(`Failed to compress memory ${memory.id}`, { memoryId: memory.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return {
      id: `compression-${Date.now()}`,
      compressedCount,
      remainingRatio: currentRatio
    };
  }
  
  /**
   * Compress a single memory (create snapshot and summarize)
   */
  private async compressMemory(memory: Memory): Promise<void> {
    // Create a snapshot compression record
    createCompression(
      memory.id,
      'snapshot',
      { 
        originalContent: memory.content,
        originalPriority: memory.priority,
        accessCount: memory.accessCount
      },
      this.summarize(memory.content)
    );
    
    // Update the memory to a summarized version
    const summary = this.summarize(memory.content);
    
    // Archive the original
    createCompression(
      memory.id,
      'archive',
      { archivedAt: new Date().toISOString() },
      summary
    );
    
    // Update memory with summary
    updateMemory(memory.id, { content: summary });
  }
  
  /**
   * Simple summarization
   */
  private summarize(content: string, maxLength: number = 200): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength - 3) + '...';
  }
  
  /**
   * Reconstruct original content from compression history
   */
  reconstructOriginal(_memoryId: string): string | null {
    return null;
  }
}

// Singleton instance
let contextCompressorInstance: ContextCompressor | null = null;

export function getContextCompressor(): ContextCompressor {
  if (!contextCompressorInstance) {
    contextCompressorInstance = new ContextCompressor();
  }
  return contextCompressorInstance;
}
