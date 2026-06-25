import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';

/**
 * Intelligent recall with MemGate-style relevance scoring
 * Combines semantic similarity with learned relevance patterns
 */

export const IntelligentRecallInput = z.object({
  query: z.string().describe('Current query or context'),
  conversation_context: z.string().optional().describe('Extended conversation context'),
  project_tags: z.array(z.string()).optional().describe('Project tags for filtering'),
  limit: z.number().int().positive().optional().default(10).describe('Maximum results'),
  relevance_threshold: z.number().min(0).max(1).optional().default(0.07)
    .describe('MemGate-style relevance threshold (default 0.07)'),
  return_mode: z.enum(['all', 'constraints_only', 'high_relevance_only']).optional()
    .default('all').describe('Return mode'),
  enable_soft_guidance: z.boolean().optional().default(true)
    .describe('Enable soft guidance (memory injection context)'),
  enable_hard_check: z.boolean().optional().default(false)
    .describe('Enable hard admissibility check')
});

export type IntelligentRecallInputType = z.infer<typeof IntelligentRecallInput>;

/**
 * Relevance scoring result
 */
export interface RelevanceScore {
  memory_id: string;
  content: string;
  priority: string;
  raw_similarity: number;
  relevance_mask: number;
  final_score: number;
  matches_constraint: boolean;
  source: 'semantic' | 'keyword' | 'hybrid';
}

/**
 * Intelligent recall output
 */
export interface IntelligentRecallOutput {
  relevant_memories: RelevanceScore[];
  soft_guidance_context: string;
  hard_check_result: {
    passed: boolean;
    violated_constraints: string[];
    fallback_action: string;
  } | null;
  search_metadata: {
    total_candidates: number;
    above_threshold: number;
    search_mode: string;
    memgate_threshold: number;
  };
}

/**
 * MemGate-style relevance calculation
 * Uses MLP-inspired pattern: [query, memory, query * memory]
 */
function calculateMemGateScore(
  queryEmbedding: number[],
  memoryEmbedding: number[],
  query: string,
  memoryContent: string
): { score: number; mask: number } {
  // 1. Cosine similarity (semantic)
  const dotProduct = queryEmbedding.reduce((sum, q, i) => sum + q * memoryEmbedding[i], 0);
  
  // 2. Relevance mask (keyword overlap bonus)
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const memoryWords = new Set(memoryContent.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const overlap = [...queryWords].filter(w => memoryWords.has(w)).length;
  const mask = Math.min(overlap / Math.max(queryWords.size, 1), 1.0);
  
  // 3. MLP-inspired interaction: [q, m, q*m]
  // Simplified: score = α * similarity + β * mask + γ * interaction
  const interactionBonus = dotProduct * mask;
  const alpha = 0.6;
  const beta = 0.3;
  const gamma = 0.1;
  
  const score = alpha * dotProduct + beta * mask + gamma * interactionBonus;
  
  return { score: Math.max(0, Math.min(1, score)), mask };
}

/**
 * Check if action violates stored constraints
 */
function hardAdmissibilityCheck(
  action: string,
  constraints: { content: string; priority: string }[]
): { passed: boolean; violated: string[] } {
  const violated: string[] = [];
  const actionLower = action.toLowerCase();
  
  for (const constraint of constraints) {
    if (constraint.priority !== 'constraint' && constraint.priority !== 'anchored') {
      continue;
    }
    
    // Check for negation patterns
    const constraintLower = constraint.content.toLowerCase();
    
    // "never do X" -> should not contain X
    if (constraintLower.includes('never')) {
      // Extract what follows "never"
      const neverMatch = constraintLower.match(/never\s+(?:do\s+)?(?:use\s+)?(?:[^,.]+)/);
      if (neverMatch) {
        const prohibitedAction = neverMatch[0].replace('never', '').trim();
        if (actionLower.includes(prohibitedAction.slice(0, Math.min(prohibitedAction.length, 20)))) {
          violated.push(constraint.content);
        }
      }
    }
    
    // "must not" / "do not" / "don't"
    if (constraintLower.includes('must not') || constraintLower.includes('do not') || constraintLower.includes('don\'t')) {
      const match = constraintLower.match(/(?:must not|do not|don\'t)\s+([^,.]+)/);
      if (match) {
        const prohibited = match[1].trim();
        if (actionLower.includes(prohibited.slice(0, Math.min(prohibited.length, 15)))) {
          violated.push(constraint.content);
        }
      }
    }
  }
  
  return {
    passed: violated.length === 0,
    violated
  };
}

/**
 * Generate soft guidance context
 */
function generateSoftGuidanceContext(memories: RelevanceScore[]): string {
  if (memories.length === 0) return '';
  
  const sections: string[] = ['## Context & Constraints\n'];
  
  // Anchored memories first
  const anchored = memories.filter(m => m.priority === 'anchored');
  if (anchored.length > 0) {
    sections.push('### Critical Rules\n');
    for (const m of anchored) {
      sections.push(`- ${m.content}`);
    }
  }
  
  // Constraints
  const constraints = memories.filter(m => m.priority === 'constraint');
  if (constraints.length > 0) {
    sections.push('\n### Constraints\n');
    for (const m of constraints) {
      sections.push(`- ${m.content}`);
    }
  }
  
  // Preferences
  const preferences = memories.filter(m => m.priority === 'preference');
  if (preferences.length > 0) {
    sections.push('\n### Preferences\n');
    for (const m of preferences.slice(0, 3)) {
      sections.push(`- ${m.content}`);
    }
  }
  
  return sections.join('\n');
}

const memoryService = getMemoryService();

export async function intelligentRecallTool(input: IntelligentRecallInputType): Promise<IntelligentRecallOutput> {
  const {
    query,
    conversation_context,
    project_tags,
    limit,
    relevance_threshold,
    return_mode,
    enable_soft_guidance,
    enable_hard_check
  } = input;
  
  // Combine query with conversation context
  const fullQuery = conversation_context 
    ? `${conversation_context}\n\nCurrent: ${query}`
    : query;
  
  // Recall memories using the service
  const memories = memoryService.recallMemories({
    query: fullQuery,
    projectTags: project_tags,
    limit: limit * 2 // Get more candidates for filtering
  });
  
  // Score each memory using MemGate-style scoring
  const scoredMemories: RelevanceScore[] = [];
  
  for (const memory of memories) {
    // Get embeddings (simplified - in production use actual embeddings)
    const queryEmbedding = generateSimpleEmbedding(fullQuery);
    const memoryEmbedding = generateSimpleEmbedding(memory.content);
    
    const { score, mask } = calculateMemGateScore(
      queryEmbedding,
      memoryEmbedding,
      fullQuery,
      memory.content
    );
    
    scoredMemories.push({
      memory_id: memory.id,
      content: memory.content,
      priority: memory.priority,
      raw_similarity: score,
      relevance_mask: mask,
      final_score: score,
      matches_constraint: memory.priority === 'constraint' || memory.priority === 'anchored',
      source: 'hybrid'
    });
  }
  
  // Sort by final score
  scoredMemories.sort((a, b) => b.final_score - a.final_score);
  
  // Filter by threshold
  const aboveThreshold = scoredMemories.filter(m => m.final_score >= relevance_threshold);
  
  // Apply return mode
  let finalMemories = aboveThreshold;
  if (return_mode === 'constraints_only') {
    finalMemories = aboveThreshold.filter(m => m.matches_constraint);
  } else if (return_mode === 'high_relevance_only') {
    finalMemories = aboveThreshold.slice(0, limit);
  }
  
  // Hard admissibility check
  let hardCheckResult = null;
  if (enable_hard_check && finalMemories.length > 0) {
    const constraints = memories.map(m => ({ content: m.content, priority: m.priority }));
    const { passed, violated } = hardAdmissibilityCheck(query, constraints);
    
    hardCheckResult = {
      passed,
      violated_constraints: violated,
      fallback_action: passed ? 'proceed' : 'reconsider_with_constraints'
    };
  }
  
  // Generate soft guidance context
  const softGuidanceContext = enable_soft_guidance
    ? generateSoftGuidanceContext(finalMemories.slice(0, limit))
    : '';
  
  return {
    relevant_memories: finalMemories.slice(0, limit),
    soft_guidance_context: softGuidanceContext,
    hard_check_result: hardCheckResult,
    search_metadata: {
      total_candidates: memories.length,
      above_threshold: aboveThreshold.length,
      search_mode: 'memgate_hybrid',
      memgate_threshold: relevance_threshold
    }
  };
}

/**
 * Generate simple embedding for scoring (placeholder for real embeddings)
 */
function generateSimpleEmbedding(text: string): number[] {
  const dim = 128;
  const vector = new Array(dim).fill(0);
  
  // Simple hash-based embedding
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < Math.min(word.length, 10); j++) {
      const idx = (word.charCodeAt(j) * (j + 1) + i) % dim;
      vector[idx] += 1 / (i + 1);
    }
  }
  
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= magnitude;
    }
  }
  
  return vector;
}
