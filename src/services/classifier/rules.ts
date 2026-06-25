import { Memory } from '../../models/types.js';

/**
 * Extract keywords from user input for rule-based matching
 */
export function extractKeywords(input: string): string[] {
  // Simple word extraction (could be enhanced with NLP)
  const words = input.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2);
  
  // Remove common stop words
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 
    'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been',
    'would', 'could', 'this', 'that', 'with', 'they', 'from', 'what',
    'when', 'where', 'which', 'their', 'there', 'these', 'those',
    'over' // common preposition
  ]);
  
  return [...new Set(words.filter(word => !stopWords.has(word)))];
}

/**
 * Extract file types mentioned in input
 */
export function extractFileTypes(input: string): string[] {
  const fileTypePatterns = [
    /\b(\w+)\.(ts|js|tsx|jsx|py|rs|go|java|cpp|c|h|hpp|rs)\b/gi,
    /\b(config|test|spec|index|main|app)\b/gi
  ];
  
  const types: string[] = [];
  
  for (const pattern of fileTypePatterns) {
    const matches = input.match(pattern);
    if (matches) {
      types.push(...matches.map(m => m.toLowerCase()));
    }
  }
  
  return [...new Set(types)];
}

/**
 * Check if a memory matches the input based on rules
 */
export function memoryMatchesRules(
  memory: Memory,
  keywords: string[],
  fileTypes: string[]
): { matches: boolean; relevance: number } {
  const contentLower = memory.content.toLowerCase();
  const memoryTags = memory.projectTags.map(t => t.toLowerCase());
  
  let matchCount = 0;
  let totalWeight = 0;
  
  // Check keyword matches
  for (const keyword of keywords) {
    if (contentLower.includes(keyword)) {
      matchCount += 2; // Keywords are more important
      totalWeight += 2;
    }
  }
  
  // Check file type matches
  for (const fileType of fileTypes) {
    if (contentLower.includes(fileType)) {
      matchCount += 1;
      totalWeight += 1;
    }
  }
  
  // Check project tag matches
  for (const tag of memoryTags) {
    if (keywords.some(k => tag.includes(k) || k.includes(tag))) {
      matchCount += 1;
      totalWeight += 1;
    }
  }
  
  const matches = matchCount > 0;
  const relevance = totalWeight > 0 ? matchCount / totalWeight : 0;
  
  return { matches, relevance };
}

/**
 * Quick filter for high-priority memories
 * Returns memories that should be directly included
 */
export function quickFilterHighPriority(
  memories: Memory[],
  keywords: string[],
  fileTypes: string[]
): Memory[] {
  const anchoredMemories = memories.filter(m => m.anchored);
  const constraintMemories = memories.filter(m => m.priority === 'constraint');
  
  // Anchored memories are always included
  const anchoredResults = anchoredMemories.map(m => ({ 
    memory: m, 
    relevance: 1.0 
  }));
  
  // Check constraint memories against rules
  const constraintResults: { memory: Memory; relevance: number }[] = [];
  for (const memory of constraintMemories) {
    const { matches, relevance } = memoryMatchesRules(memory, keywords, fileTypes);
    if (matches) {
      constraintResults.push({ memory, relevance });
    }
  }
  
  // Sort constraint results by relevance
  constraintResults.sort((a, b) => b.relevance - a.relevance);
  
  // Combine and return
  return [
    ...anchoredResults.map(r => r.memory),
    ...constraintResults.slice(0, 5).map(r => r.memory) // Limit to top 5 constraints
  ];
}
