/**
 * LLM-powered Constraint Extractor
 *
 * 当配置了 LLM provider 时，使用 LLM 从对话轮次中提取约束。
 * 作为 memory-extract.ts 中关键词提取的升级版。
 */

import { getLLMConfig, summarizeContent } from './llm.js';

export interface LLMExtractedConstraint {
  content: string;
  type: 'constraint' | 'preference' | 'workflow' | 'rule';
  confidence: number;
  triggers: string[];
  reasoning: string;
}

export interface LLMExtractionResult {
  constraints: LLMExtractedConstraint[];
  summary: string;
  provider: string;
  used_llm: boolean;
}

/** 使用 LLM 提取约束 */
export async function extractConstraintsWithLLM(
  conversationTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
  extractMode: 'all' | 'constraints_only' | 'preferences_only' = 'all',
  _minConfidence: number = 0.5
): Promise<LLMExtractionResult> {
  const config = getLLMConfig();

  // 如果未配置 LLM，返回空结果
  if (config.provider === 'none') {
    return {
      constraints: [],
      summary: 'No LLM configured, using keyword-based extraction instead',
      provider: 'none',
      used_llm: false,
    };
  }

  // 构建提示词
  const modeInstruction = {
    all: 'Extract all types: constraints, preferences, workflows, and rules.',
    constraints_only: 'Extract only hard constraints and rules (things that must/must not be done).',
    preferences_only: 'Extract only user preferences and style choices.',
  }[extractMode];

  const userTurns = conversationTurns
    .filter(t => t.role === 'user')
    .map((t, i) => `[${i + 1}] ${t.content}`)
    .join('\n');

  const prompt = `You are a constraint extractor for an AI coding assistant.

Analyze the following user messages from a coding session. Extract durable constraints, preferences, and workflows that the user has established.

${modeInstruction}

For each extraction, provide:
- content: The constraint/preference text (exact quote or paraphrase)
- type: one of "constraint", "preference", "workflow", "rule"
- confidence: 0.0-1.0 (higher = more confident it's durable, not a one-shot request)
- triggers: keywords or patterns that should activate this constraint
- reasoning: why this was extracted

Rules:
- Only extract from USER messages, not assistant responses
- Skip one-shot requests (e.g., "can you fix this bug", "write a function")
- Look for patterns like "always/never/must/prefer/instead of/rather than"
- Confidence < 0.5 should be filtered out
- Focus on what the user wants consistently, not what they asked once

User messages:
${userTurns}

Output as JSON array with the structure described above. Return an empty array if no durable constraints found.`;

  try {
    const summary = await summarizeContent(prompt, 4000);
    // 解析 LLM 返回的 JSON
    const parsed = parseLLMResponse(summary);

    return {
      constraints: parsed,
      summary: `Extracted ${parsed.length} constraint(s) using ${config.provider} ${config.model}`,
      provider: `${config.provider}/${config.model}`,
      used_llm: true,
    };
  } catch (error) {
    return {
      constraints: [],
      summary: `LLM extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      provider: `${config.provider}/${config.model}`,
      used_llm: false,
    };
  }
}

/** 解析 LLM 返回的 JSON */
function parseLLMResponse(text: string): LLMExtractedConstraint[] {
  // 尝试提取 JSON 代码块
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is LLMExtractedConstraint =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.content === 'string' &&
          typeof item.type === 'string' &&
          typeof item.confidence === 'number'
        )
        .filter(item => item.confidence >= 0.5)
        .slice(0, 10);
    }
  } catch {
    // JSON 解析失败，尝试从文本中提取
  }

  return [];
}
