/**
 * After-Chain 执行器
 *
 * 负责执行 After-Chain 编排逻辑：
 * - 在工具返回后触发后续工具
 * - 管理会话上下文（传递 conversation_turns 给 memory_extract）
 */

import { getAfterChainRegistry, AfterChainEvent, ToolName } from './after-chain.js';
import { memoryExtractTool } from '../mcp/tools/memory-extract.js';

/** 会话上下文（存储最近对话轮次） */
interface SessionContext {
  recentTurns: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  maxTurns: number;
}

const sessionContext: SessionContext = {
  recentTurns: [],
  maxTurns: 50,
};

/** 记录对话轮次（供 after-chain 使用） */
export function recordConversationTurn(role: 'user' | 'assistant', content: string): void {
  sessionContext.recentTurns.push({
    role,
    content,
    timestamp: Date.now(),
  });
  // 保留最近 N 轮
  if (sessionContext.recentTurns.length > sessionContext.maxTurns) {
    sessionContext.recentTurns = sessionContext.recentTurns.slice(-sessionContext.maxTurns);
  }
}

/** 清空会话上下文 */
export function clearSessionContext(): void {
  sessionContext.recentTurns = [];
}

/** 工具处理器接口 */
interface ToolHandler {
  (params: Record<string, unknown>): Promise<unknown>;
}

/** 工具处理器注册表 */
const toolHandlers: Record<string, ToolHandler> = {};

/** 注册工具处理器 */
export function registerToolHandler(toolName: string, handler: ToolHandler): void {
  toolHandlers[toolName] = handler;
}

/**
 * 执行通用 followupTool
 */
async function executeGenericFollowup(
  followupTool: ToolName,
  input: unknown,
  output: unknown
): Promise<{ success: boolean; error?: string }> {
  // memory_extract 需要 conversation_turns
  if (followupTool === 'memory_extract') {
    const conversation_turns = sessionContext.recentTurns
      .slice(-20)
      .map(t => ({ role: t.role, content: t.content }));

    if (conversation_turns.length === 0) {
      return { success: false, error: 'No conversation turns available for extraction' };
    }

    await memoryExtractTool({
      conversation_turns,
      extract_mode: 'all',
      min_confidence: 0.5,
      use_llm: true,
    });
    return { success: true };
  }

  // 检查注册表中的处理器
  const handler = toolHandlers[followupTool];
  if (handler) {
    // 从 input/output 派生参数
    const params = deriveToolParams(followupTool, input, output);
    await handler(params);
    return { success: true };
  }

  return { success: false, error: `No handler for followupTool: ${followupTool}` };
}

/**
 * 从 input/output 派生工具参数
 */
function deriveToolParams(
  followupTool: ToolName,
  input: unknown,
  output: unknown
): Record<string, unknown> {
  const inputObj = input as Record<string, unknown>;
  const outputObj = output as Record<string, unknown>;

  switch (followupTool) {
    case 'memory_recall':
      return {
        query: (inputObj.content as string) || (inputObj.key as string) || (outputObj.value as string) || '',
        limit: 10,
        search_mode: 'auto',
      };
    case 'memory_stats':
      return {};
    case 'intelligent_recall':
      return {
        query: (inputObj.content as string) || (inputObj.key as string) || '',
        limit: 10,
        relevance_threshold: 0.07,
      };
    case 'dual_mode_execute':
      return {
        action: (inputObj.content as string) || (inputObj.value as string) || '',
        context: JSON.stringify(inputObj),
        mode: 'soft_only',
      };
    default:
      return { ...inputObj };
  }
}

/** 执行 After-Chain 钩子 */
export async function executeAfterChain(
  triggerTool: string,
  input: unknown,
  output: unknown
): Promise<void> {
  const registry = getAfterChainRegistry();

  if (!registry.getGlobalConfig().enabled) return;

  const hooks = registry.getFollowups(triggerTool as ToolName);
  if (hooks.length === 0) return;

  for (const hook of hooks) {
    // 检查条件
    if (hook.condition && !hook.condition(input, output)) continue;

    const event: AfterChainEvent = {
      chain: '',
      triggerTool: hook.triggerTool,
      followupTool: hook.followupTool,
      timestamp: new Date().toISOString(),
      input,
      output,
      success: false,
    };

    try {
      const result = await executeGenericFollowup(hook.followupTool, input, output);
      event.success = result.success;
      event.error = result.error;
    } catch (error) {
      event.success = false;
      event.error = error instanceof Error ? error.message : String(error);
    }

    registry.emit(event);
  }
}

/** 从会话上下文获取最近的对话轮次 */
export function getRecentConversationTurns(limit?: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const turns = limit ? sessionContext.recentTurns.slice(-limit) : sessionContext.recentTurns;
  return turns.map(t => ({ role: t.role, content: t.content }));
}
