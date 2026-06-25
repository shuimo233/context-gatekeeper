import { Memory } from '../../models/types.js';
import { getMemoryService } from '../memory.js';
import { extractKeywords, extractFileTypes, quickFilterHighPriority } from './rules.js';
import { getLLMClassifier, LLMClassifier, LLMConfig } from './llm.js';

export interface ClassificationResult {
  memory: Memory;
  relevance: number;
  matchedBy: 'rule' | 'llm' | 'both';
}

/**
 * Hybrid Classifier - combines rule-based and LLM-based classification
 */
export class HybridClassifier {
  private memoryService = getMemoryService();
  private llmClassifier: LLMClassifier;
  
  constructor(llmConfig?: LLMConfig) {
    this.llmClassifier = getLLMClassifier(llmConfig);
  }
  
  /**
   * Configure LLM settings
   */
  configureLLM(config: Partial<LLMConfig>): void {
    this.llmClassifier.configure(config);
  }
  
  /**
   * Classify and rank memories for a given user input
   * 
   * Process:
   * 1. Rule-based quick filter (anchored + constraint)
   * 2. LLM-based precise classification
   * 3. Merge and deduplicate results
   * 4. Sort by relevance
   */
  async classify(
    userInput: string,
    projectTags?: string[],
    limit: number = 10
  ): Promise<ClassificationResult[]> {
    // Extract features for rule matching
    const keywords = extractKeywords(userInput);
    const fileTypes = extractFileTypes(userInput);
    
    // Step 1: Rule-based quick filter
    const allMemories = this.memoryService.listAllMemories(projectTags);
    const ruleMatches = quickFilterHighPriority(allMemories, keywords, fileTypes);
    
    // Step 2: LLM-based precise classification
    let llmResults: { memoryId: string; relevance: number }[] = [];
    try {
      llmResults = await this.llmClassifier.classify(userInput, allMemories);
    } catch {
      // LLM failed, continue with rules only
    }
    
    // Step 3: Merge results
    const resultsMap = new Map<string, ClassificationResult>();
    
    // Add rule matches
    for (const memory of ruleMatches) {
      resultsMap.set(memory.id, {
        memory,
        relevance: 0.8, // Rule matches get high base relevance
        matchedBy: 'rule'
      });
    }
    
    // Add LLM matches (boost if already matched by rules)
    for (const { memoryId, relevance } of llmResults) {
      const existing = resultsMap.get(memoryId);
      if (existing) {
        existing.relevance = Math.min(1.0, existing.relevance + relevance * 0.2);
        existing.matchedBy = 'both';
      } else {
        const memory = this.memoryService.getMemory(memoryId);
        if (memory) {
          resultsMap.set(memoryId, {
            memory,
            relevance,
            matchedBy: 'llm'
          });
        }
      }
    }
    
    // Step 4: Sort by relevance
    const results = Array.from(resultsMap.values());
    results.sort((a, b) => b.relevance - a.relevance);
    
    // Update access counts for returned memories
    for (const result of results) {
      this.memoryService.getMemory(result.memory.id); // Triggers access count increment
    }
    
    return results.slice(0, limit);
  }
  
  /**
   * Quick classify using only rules (no LLM)
   * Useful when LLM is unavailable
   */
  classifyWithRules(
    userInput: string,
    projectTags?: string[],
    limit: number = 10
  ): ClassificationResult[] {
    const keywords = extractKeywords(userInput);
    const fileTypes = extractFileTypes(userInput);
    
    const allMemories = this.memoryService.listAllMemories(projectTags);
    const ruleMatches = quickFilterHighPriority(allMemories, keywords, fileTypes);
    
    return ruleMatches.slice(0, limit).map(memory => ({
      memory,
      relevance: 0.8,
      matchedBy: 'rule' as const
    }));
  }
}

// Singleton instance
let hybridClassifierInstance: HybridClassifier | null = null;

export function getHybridClassifier(llmConfig?: LLMConfig): HybridClassifier {
  if (!hybridClassifierInstance) {
    hybridClassifierInstance = new HybridClassifier(llmConfig);
  }
  return hybridClassifierInstance;
}
