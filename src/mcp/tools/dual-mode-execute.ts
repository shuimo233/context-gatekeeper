import { z } from 'zod';
import { getMemoryService } from '../../services/memory.js';

/**
 * Dual-Mode Execution Tool
 * Combines AutoSkill-style soft guidance with MPR-style hard admissibility
 * Follows Meta-Policy Reflexion principles
 */

export const DualModeExecuteInput = z.object({
  action: z.string().describe('Proposed action to validate'),
  context: z.string().describe('Current execution context'),
  project_tags: z.array(z.string()).optional().describe('Project tags for constraint lookup'),
  mode: z.enum(['soft_only', 'hard_only', 'dual']).optional().default('dual')
    .describe('Execution mode: soft (guidance), hard (check), or dual (both)'),
  soft_guidance_style: z.enum(['concise', 'detailed', 'minimal']).optional().default('concise')
    .describe('How much guidance to inject'),
  hard_threshold: z.number().min(0).max(1).optional().default(0.5)
    .describe('Threshold for hard admissibility')
});

export type DualModeExecuteInputType = z.infer<typeof DualModeExecuteInput>;

/**
 * Constraint violation detail
 */
export interface ConstraintViolation {
  constraint: string;
  priority: string;
  severity: 'critical' | 'warning' | 'info';
  matched_pattern: string;
  suggestion: string;
}

/**
 * Soft guidance response
 */
export interface SoftGuidance {
  injected_context: string;
  suggested_modifications: string[];
  relevant_preferences: string[];
  relevant_workflows: string[];
}

/**
 * Hard admissibility result
 */
export interface HardAdmissibility {
  allowed: boolean;
  violations: ConstraintViolation[];
  severity: 'proceed' | 'warn' | 'block';
  fallback_suggestion: string;
}

/**
 * Dual mode output
 */
export interface DualModeExecuteOutput {
  action: string;
  soft_guidance: SoftGuidance | null;
  hard_admissibility: HardAdmissibility | null;
  final_decision: {
    action: 'proceed' | 'modify' | 'block' | 'reconsider';
    modified_action: string | null;
    reasoning: string;
  };
  metadata: {
    mode: string;
    constraints_evaluated: number;
    preferences_found: number;
    execution_time_ms: number;
  };
}

/**
 * Priority weights for severity
 */
const PRIORITY_SEVERITY: Record<string, 'critical' | 'warning' | 'info'> = {
  'anchored': 'critical',
  'constraint': 'warning',
  'decision': 'warning',
  'preference': 'info',
  'fact': 'info'
};

/**
 * Soft mode: Inject guidance context
 */
function generateSoftGuidance(
  action: string,
  memories: { content: string; priority: string; id: string }[],
  style: 'concise' | 'detailed' | 'minimal'
): SoftGuidance {
  // Categorize memories
  const anchors = memories.filter(m => m.priority === 'anchored');
  const constraints = memories.filter(m => m.priority === 'constraint');
  const decisions = memories.filter(m => m.priority === 'decision');
  const preferences = memories.filter(m => m.priority === 'preference');
  
  // Generate context based on style
  let injected_context = '';
  const sections: string[] = [];
  
  if (style === 'minimal') {
    // Only anchors
    if (anchors.length > 0) {
      sections.push(`Critical: ${anchors.map(a => a.content).join('; ')}`);
    }
  } else if (style === 'concise') {
    // Anchors + constraints
    if (anchors.length > 0) {
      sections.push(`## Critical Rules\n${anchors.map(a => `- ${a.content}`).join('\n')}`);
    }
    if (constraints.length > 0) {
      sections.push(`\n## Constraints\n${constraints.map(c => `- ${c.content}`).join('\n')}`);
    }
    if (preferences.length > 0) {
      sections.push(`\n## Preferences\n${preferences.slice(0, 2).map(p => `- ${p.content}`).join('\n')}`);
    }
  } else {
    // Full detail
    if (anchors.length > 0) {
      sections.push(`## Critical Rules\n${anchors.map(a => `- ${a.content}`).join('\n')}`);
    }
    if (constraints.length > 0) {
      sections.push(`\n## Constraints\n${constraints.map(c => `- ${c.content}`).join('\n')}`);
    }
    if (decisions.length > 0) {
      sections.push(`\n## Past Decisions\n${decisions.map(d => `- ${d.content}`).join('\n')}`);
    }
    if (preferences.length > 0) {
      sections.push(`\n## Preferences\n${preferences.map(p => `- ${p.content}`).join('\n')}`);
    }
  }
  
  injected_context = sections.join('\n');
  
  // Generate suggestions
  const suggested_modifications: string[] = [];
  
  // Analyze action for potential improvements
  const actionLower = action.toLowerCase();
  
  for (const pref of preferences) {
    if (actionLower.includes('class') && pref.content.toLowerCase().includes('functional')) {
      suggested_modifications.push('Consider using functional patterns instead of classes');
    }
    if (actionLower.includes('var ') && pref.content.toLowerCase().includes('typescript')) {
      suggested_modifications.push('Use TypeScript types instead of var');
    }
  }
  
  return {
    injected_context,
    suggested_modifications,
    relevant_preferences: preferences.map(p => p.content),
    relevant_workflows: [] // Would come from workflow-type memories
  };
}

/**
 * Hard mode: Validate against constraints
 */
function performHardAdmissibilityCheck(
  action: string,
  memories: { content: string; priority: string; id: string }[],
  _threshold: number
): HardAdmissibility {
  const violations: ConstraintViolation[] = [];
  const actionLower = action.toLowerCase();
  
  // Extract constraint patterns
  const NEGATION_PATTERNS = [
    { pattern: /\bnever\s+(?:do\s+)?(?:use\s+)?(.+?)(?:\.|,|$)/gi, type: 'never' },
    { pattern: /\bmust\s+not\s+(.+?)(?:\.|,|$)/gi, type: 'must not' },
    { pattern: /\bdo\s+not\s+(.+?)(?:\.|,|$)/gi, type: 'do not' },
    { pattern: /\bdont\s+(.+?)(?:\.|,|$)/gi, type: 'dont' },
    { pattern: /\bavoid\s+(.+?)(?:\.|,|$)/gi, type: 'avoid' },
    { pattern: /\bforbidden\s+to\s+(.+?)(?:\.|,|$)/gi, type: 'forbidden' },
    { pattern: /\bonly\s+(.+?)(?:\.|,|$)/gi, type: 'only' },
  ];

  // Check each constraint
  for (const memory of memories) {
    if (memory.priority !== 'constraint' && memory.priority !== 'anchored') {
      continue;
    }
    
    const contentLower = memory.content.toLowerCase();
    
    // Check negation patterns
    for (const { pattern, type } of NEGATION_PATTERNS) {
      const matches = [...contentLower.matchAll(pattern)];
      
      for (const match of matches) {
        const prohibited = match[1]?.trim();
        if (!prohibited) continue;
        
        // Check if action contains the prohibited pattern
        const prohibitedWords = prohibited.split(/\s+/).slice(0, 3);
        const matchCount = prohibitedWords.filter(w => actionLower.includes(w)).length;
        
        if (matchCount >= Math.ceil(prohibitedWords.length * 0.6)) {
          violations.push({
            constraint: memory.content,
            priority: memory.priority,
            severity: PRIORITY_SEVERITY[memory.priority] || 'warning',
            matched_pattern: `${type}: "${prohibited}"`,
            suggestion: `Avoid ${type} pattern. ${prohibited} is prohibited.`
          });
        }
      }
    }
    
    // Check for "must" requirements
    const mustMatch = contentLower.match(/\bmust\s+(.+?)(?:\.|,|$)/i);
    if (mustMatch) {
      const requirement = mustMatch[1]?.trim();
      if (requirement && !actionLower.includes(requirement.slice(0, Math.min(requirement.length, 10)))) {
        violations.push({
          constraint: memory.content,
          priority: memory.priority,
          severity: 'warning',
          matched_pattern: `missing: "${requirement}"`,
          suggestion: `Action should ${requirement}`
        });
      }
    }
  }
  
  // Determine severity
  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  
  let severity: 'proceed' | 'warn' | 'block';
  let allowed: boolean;
  
  if (criticalCount > 0) {
    severity = 'block';
    allowed = false;
  } else if (warningCount > 0) {
    severity = 'warn';
    allowed = true;
  } else {
    severity = 'proceed';
    allowed = true;
  }
  
  return {
    allowed,
    violations,
    severity,
    fallback_suggestion: violations.length > 0
      ? `Address ${violations.length} constraint(s) before proceeding`
      : 'Action approved'
  };
}

/**
 * Generate modified action based on violations
 */
function generateModifiedAction(
  action: string,
  violations: ConstraintViolation[]
): string | null {
  const suggestions: string[] = [];
  
  for (const violation of violations) {
    if (violation.matched_pattern.startsWith('avoid:')) {
      const match = violation.matched_pattern.match(/avoid:\s*"?(.+?)"?/);
      if (match) {
        suggestions.push(`Remove references to: ${match[1]}`);
      }
    }
    if (violation.matched_pattern.startsWith('missing:')) {
      const match = violation.matched_pattern.match(/missing:\s*"?(.+?)"?/);
      if (match) {
        suggestions.push(`Add: ${match[1]}`);
      }
    }
  }
  
  if (suggestions.length === 0) return null;
  
  return `${action}\n\n// Note: Please address the following before finalizing:\n${suggestions.map(s => `// - ${s}`).join('\n')}`;
}

const memoryService = getMemoryService();

export async function dualModeExecuteTool(input: DualModeExecuteInputType): Promise<DualModeExecuteOutput> {
  const startTime = Date.now();
  
  const {
    action,
    context,
    project_tags,
    mode = 'dual',
    soft_guidance_style = 'concise',
    hard_threshold = 0.5
  } = input;
  
  // Combine context with query for memory retrieval
  const fullQuery = context ? `${context}\n\nAction: ${action}` : action;
  
  // Retrieve relevant memories
  const memories = await memoryService.recallMemories({
    query: fullQuery,
    projectTags: project_tags,
    limit: 20
  });
  
  // Execute based on mode
  let softGuidance: SoftGuidance | null = null;
  let hardAdmissibility: HardAdmissibility | null = null;
  
  if (mode === 'soft_only' || mode === 'dual') {
    softGuidance = generateSoftGuidance(action, memories, soft_guidance_style);
  }
  
  if (mode === 'hard_only' || mode === 'dual') {
    hardAdmissibility = performHardAdmissibilityCheck(action, memories, hard_threshold);
  }
  
  // Determine final decision
  let finalDecision: DualModeExecuteOutput['final_decision'];
  
  if (mode === 'soft_only') {
    finalDecision = {
      action: 'proceed',
      modified_action: null,
      reasoning: 'Soft guidance mode: action proceeds with injected context'
    };
  } else if (mode === 'hard_only') {
    if (!hardAdmissibility) {
      finalDecision = { action: 'proceed', modified_action: null, reasoning: 'No constraints found' };
    } else if (hardAdmissibility.severity === 'block') {
      finalDecision = {
        action: 'block',
        modified_action: null,
        reasoning: `Blocked by ${hardAdmissibility.violations.filter(v => v.severity === 'critical').length} critical constraint(s)`
      };
    } else if (hardAdmissibility.severity === 'warn') {
      finalDecision = {
        action: 'modify',
        modified_action: null,
        reasoning: `${hardAdmissibility.violations.length} warning(s) found`
      };
    } else {
      finalDecision = { action: 'proceed', modified_action: null, reasoning: 'Hard check passed' };
    }
  } else {
    // Dual mode
    if (!hardAdmissibility) {
      finalDecision = {
        action: 'proceed',
        modified_action: null,
        reasoning: softGuidance 
          ? 'Soft guidance provided, no hard constraints found'
          : 'No constraints found'
      };
    } else if (!hardAdmissibility.allowed) {
      finalDecision = {
        action: 'block',
        modified_action: null,
        reasoning: `Blocked: ${hardAdmissibility.violations.map(v => v.matched_pattern).join(', ')}`
      };
    } else if (hardAdmissibility.violations.length > 0) {
      finalDecision = {
        action: 'modify',
        modified_action: generateModifiedAction(action, hardAdmissibility.violations),
        reasoning: `${hardAdmissibility.violations.length} constraint(s) need addressing`
      };
    } else {
      finalDecision = {
        action: 'proceed',
        modified_action: null,
        reasoning: 'All constraints satisfied'
      };
    }
  }
  
  return {
    action,
    soft_guidance: softGuidance,
    hard_admissibility: hardAdmissibility,
    final_decision: finalDecision,
    metadata: {
      mode,
      constraints_evaluated: memories.filter(m => m.priority === 'constraint' || m.priority === 'anchored').length,
      preferences_found: memories.filter(m => m.priority === 'preference').length,
      execution_time_ms: Date.now() - startTime
    }
  };
}
