import { z } from 'zod';

/**
 * Constraint extraction input schema
 * Follows AutoSkill's P_ext principles:
 * - Only use user queries, not assistant responses
 * - Extract "durable constraints" not "one-shot requests"
 * - Identify reusable patterns
 */
export const MemoryExtractInput = z.object({
  conversation_turns: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).min(1).describe('Conversation turns to analyze'),
  project_tags: z.array(z.string()).optional().describe('Project tags for extracted constraints'),
  extract_mode: z.enum(['all', 'constraints_only', 'preferences_only']).optional()
    .default('all').describe('Extraction mode'),
  min_confidence: z.number().min(0).max(1).optional().default(0.5)
    .describe('Minimum confidence threshold'),
  use_llm: z.boolean().optional().default(true)
    .describe('Use LLM extraction when available (fallback to keywords if unavailable)')
});

export type MemoryExtractInputType = z.infer<typeof MemoryExtractInput>;

/**
 * Extracted constraint result
 */
export interface ExtractedConstraint {
  content: string;
  type: 'constraint' | 'preference' | 'workflow' | 'rule';
  confidence: number;
  triggers: string[];
  source_turns: number[];
  reasoning: string;
}

/**
 * Constraint extraction output
 */
export interface MemoryExtractOutput {
  constraints: ExtractedConstraint[];
  summary: string;
  extraction_mode: string;
  total_turns_analyzed: number;
}

/**
 * Keywords that indicate durable constraints vs one-shot requests
 */
const CONSTRAINT_INDICATORS = [
  "always", "never", "must", "should", "prefer", "avoid",
  "only", "must not", "required", "mandatory", "forbidden",
  "consistently", "habitually", "typically", "usually", "normally",
  "I want", "I need", "I prefer", "I hate", "I like",
  "follow", "adhere to", "maintain", "keep", "preserve",
  "instead of", "rather than", "instead", "rather"
];

const PREFERENCE_INDICATORS = [
  'I like', 'I prefer', 'I enjoy', 'I hate', 'I dislike',
  'better', 'worse', 'more', 'less', 'rather', 'instead',
  'favorite', 'least favorite', 'ideal', 'perfect'
];

const WORKFLOW_INDICATORS = [
  'step', 'first', 'then', 'next', 'finally', 'lastly',
  'process', 'workflow', 'procedure', 'sequence', 'order',
  'begin with', 'start by', 'end with', 'finish with',
  'before', 'after', 'during', 'through'
];

const RULE_INDICATORS = [
  'rule', 'policy', 'convention', 'standard', ' guideline',
  'pattern', 'format', 'style', 'convention',
  'must follow', 'should follow', 'need to follow'
];

/**
 * One-shot request indicators (should be filtered out)
 */
const ONESHOT_INDICATORS = [
  'can you', 'could you', 'would you', 'please',
  'help me', 'show me', 'tell me', 'explain',
  'how do i', 'how to', 'what is', 'what are',
  'write a', 'create a', 'make a', 'build a',
  'just', 'only', 'this time'
];

/**
 * Check if a sentence contains constraint indicators
 */
function containsConstraintIndicators(text: string): boolean {
  const lowerText = text.toLowerCase();
  return CONSTRAINT_INDICATORS.some(indicator => lowerText.includes(indicator));
}

/**
 * Check if a sentence is likely a one-shot request
 */
function isOneShotRequest(text: string): boolean {
  const lowerText = text.toLowerCase();
  // Check if it's a direct question or request
  if (ONESHOT_INDICATORS.some(ind => lowerText.includes(ind))) {
    return true;
  }
  // Check if it's a very short message
  if (text.split(/\s+/).length < 5) {
    return true;
  }
  return false;
}

/**
 * Classify the type of extracted constraint
 */
function classifyConstraint(text: string): ExtractedConstraint['type'] {
  const lowerText = text.toLowerCase();
  
  if (WORKFLOW_INDICATORS.some(ind => lowerText.includes(ind))) {
    return 'workflow';
  }
  if (RULE_INDICATORS.some(ind => lowerText.includes(ind))) {
    return 'rule';
  }
  if (PREFERENCE_INDICATORS.some(ind => lowerText.includes(ind))) {
    return 'preference';
  }
  return 'constraint';
}

/**
 * Extract triggers from text
 */
function extractTriggers(text: string): string[] {
  const triggers: string[] = [];
  const lowerText = text.toLowerCase();
  
  // Extract quoted phrases
  const quotedMatches = text.match(/"([^"]+)"/g);
  if (quotedMatches) {
    triggers.push(...quotedMatches.map(m => m.slice(1, -1)));
  }
  
  // Extract technical terms
  const techTerms = text.match(/\b[\w]+[\w-]*\.(ts|js|tsx|jsx|py|rs|go|java|cpp)\b/g);
  if (techTerms) {
    triggers.push(...techTerms.map(t => t.split('.')[1]));
  }
  
  // Extract patterns after "when" or "if"
  const conditionalMatches = lowerText.match(/(?:when|if|whenever|before|after)\s+([^,.]+)/g);
  if (conditionalMatches) {
    triggers.push(...conditionalMatches);
  }
  
  return [...new Set(triggers)].slice(0, 5);
}

/**
 * Calculate confidence score for extracted constraint
 */
function calculateConfidence(text: string, _turnIndex: number, totalTurns: number): number {
  let confidence = 0.5;
  
  // More turns mentioning = higher confidence
  if (totalTurns > 1) {
    confidence += 0.1;
  }
  
  // Explicit constraint language = higher confidence
  if (containsConstraintIndicators(text)) {
    confidence += 0.2;
  }
  
  // Not a one-shot request = higher confidence
  if (!isOneShotRequest(text)) {
    confidence += 0.2;
  }
  
  // Specific and detailed = higher confidence
  if (text.split(/\s+/).length > 10) {
    confidence += 0.1;
  }
  
  return Math.min(confidence, 1.0);
}

/**
 * Extract constraints from user turns only
 */
export async function memoryExtractTool(input: MemoryExtractInputType): Promise<MemoryExtractOutput> {
  const { conversation_turns, project_tags: _project_tags, extract_mode, min_confidence, use_llm = true } = input;

  // 尝试使用 LLM 提取（如果配置了且启用）
  if (use_llm) {
    try {
      const { extractConstraintsWithLLM } = await import('../../services/constraint-extractor.js');
      const llmResult = await extractConstraintsWithLLM(conversation_turns, extract_mode || 'all', min_confidence);

      if (llmResult.used_llm && llmResult.constraints.length > 0) {
        // 合并 LLM 提取结果与关键词提取结果
        const keywordConstraints = extractWithKeywords(conversation_turns, extract_mode || 'all', min_confidence);
        const mergedConstraints = [...llmResult.constraints.map(c => ({
          content: c.content,
          type: c.type,
          confidence: c.confidence,
          triggers: c.triggers,
          source_turns: [],
          reasoning: c.reasoning,
        })), ...keywordConstraints];
        const deduplicated = deduplicateConstraints(mergedConstraints);
        return {
          constraints: deduplicated,
          summary: `${llmResult.summary}; keyword fallback found ${keywordConstraints.length} additional constraint(s)`,
          extraction_mode: extract_mode || 'all',
          total_turns_analyzed: conversation_turns.length,
        };
      }
    } catch {
      // LLM 提取失败，降级到关键词提取
    }
  }

  // 关键词提取（降级路径）
  const constraints = extractWithKeywords(conversation_turns, extract_mode || 'all', min_confidence);
  const deduplicated = deduplicateConstraints(constraints);
  const summary = generateSummary(deduplicated);

  return {
    constraints: deduplicated,
    summary,
    extraction_mode: extract_mode || 'all',
    total_turns_analyzed: conversation_turns.length,
  };
}

/**
 * 关键词提取（降级方案）
 */
function extractWithKeywords(
  conversation_turns: Array<{ role: 'user' | 'assistant'; content: string; originalIndex?: number }>,
  extract_mode: 'all' | 'constraints_only' | 'preferences_only',
  min_confidence: number
): ExtractedConstraint[] {
  // Filter to user turns only (following AutoSkill principle)
  const userTurns = conversation_turns
    .filter(turn => turn.role === 'user')
    .map((turn, index) => ({ ...turn, originalIndex: index }));

  const extractedConstraints: ExtractedConstraint[] = [];

  for (const turn of userTurns) {
    const content = turn.content;

    // Skip one-shot requests
    if (isOneShotRequest(content)) {
      continue;
    }

    // Analyze sentence by sentence
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 15) continue;

      const type = classifyConstraint(trimmed);
      const confidence = calculateConfidence(trimmed, turn.originalIndex ?? 0, userTurns.length);

      // Filter by mode and confidence
      if (confidence < min_confidence) continue;

      if (extract_mode === 'constraints_only' && type !== 'constraint' && type !== 'rule') continue;
      if (extract_mode === 'preferences_only' && type !== 'preference') continue;

      extractedConstraints.push({
        content: trimmed,
        type,
        confidence,
        triggers: extractTriggers(trimmed),
        source_turns: [turn.originalIndex ?? 0],
        reasoning: `Extracted from user turn ${(turn.originalIndex ?? 0) + 1} with ${type} pattern`,
      });
    }
  }

  return extractedConstraints;
}

/**
 * Deduplicate similar constraints using simple similarity
 */
function deduplicateConstraints(constraints: ExtractedConstraint[]): ExtractedConstraint[] {
  const result: ExtractedConstraint[] = [];
  
  for (const constraint of constraints) {
    const isDuplicate = result.some(existing => {
      const similarity = calculateTextSimilarity(constraint.content, existing.content);
      return similarity > 0.7;
    });
    
    if (!isDuplicate) {
      result.push(constraint);
    }
  }
  
  return result;
}

/**
 * Calculate simple text similarity (Jaccard)
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Generate summary of extracted constraints
 */
function generateSummary(constraints: ExtractedConstraint[]): string {
  if (constraints.length === 0) {
    return 'No durable constraints or preferences detected in the conversation.';
  }
  
  const byType = {
    constraint: constraints.filter(c => c.type === 'constraint' || c.type === 'rule'),
    preference: constraints.filter(c => c.type === 'preference'),
    workflow: constraints.filter(c => c.type === 'workflow')
  };
  
  const parts: string[] = [];
  
  if (byType.constraint.length > 0) {
    parts.push(`${byType.constraint.length} constraint(s)`);
  }
  if (byType.preference.length > 0) {
    parts.push(`${byType.preference.length} preference(s)`);
  }
  if (byType.workflow.length > 0) {
    parts.push(`${byType.workflow.length} workflow(s)`);
  }
  
  return `Extracted ${parts.join(', ')} from conversation.`;
}
