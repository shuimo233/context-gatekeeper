import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

import { logger } from '../utils/logger.js';
import { initDatabase } from '../utils/db.js';
import { executeAfterChain, recordConversationTurn } from '../utils/after-chain-executor.js';
import { getAfterChainRegistry } from '../utils/after-chain.js';
import { initSchema } from '../schema/index.js';
import {
  getWatchdogTokenManager,
  checkPermission,
  READ_ONLY_TOOLS,
  READ_WRITE_TOOLS,
  WatchdogTokenManager,
  TOOL_PERMISSIONS,
} from '../utils/watchdog.js';
import {
  memoryStoreTool,
  memoryRecallTool,
  memoryAnchorTool,
  memoryReportUsageTool,
  contextCompressTool,
  projectCreateTool,
  memoryStoreBatchTool,
  memoryDeleteBatchTool,
  memorySearchTool,
  configureLLMTool,
  memoryStatsTool,
  memoryExtractTool,
  intelligentRecallTool,
  dualModeExecuteTool
} from './tools/index.js';

const mcpServer = new McpServer({
  name: 'context-gatekeeper',
  version: '0.2.1'
});

// Initialize database asynchronously
async function initialize(): Promise<void> {
  try {
    await initDatabase();
    initSchema();
  } catch (error) {
    logger.error('Failed to initialize database', { error });
    throw error;
  }
}

/**
 * Main entry point - start the MCP server
 */
mcpServer.registerTool('memory_store', {
  description: 'Store a new memory with automatic embedding and deduplication',
  inputSchema: {
    content: z.string().min(1).describe('The memory content'),
    priority: z.enum(['anchored', 'constraint', 'decision', 'preference', 'fact']).describe('Priority level'),
    project_tags: z.array(z.string()).optional().describe('Project tags for filtering'),
    anchored: z.boolean().optional().describe('Whether this memory is anchored (permanent)'),
    expires_in_hours: z.number().positive().optional().describe('TTL in hours'),
    updated_by: z.string().optional().describe('Source that updated this memory'),
    user_id: z.string().optional().default('default').describe('User ID for storage isolation'),
    agent_id: z.string().optional().default('default').describe('Agent ID for storage isolation'),
    project_id: z.string().optional().default('default').describe('Project ID for storage isolation'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ content, priority, project_tags, anchored, expires_in_hours, updated_by, user_id, agent_id, project_id, token }) => {
  const start = performance.now();
  try {
    const permission = checkPermission('memory_store', token || '');
    if (!permission.allowed) {
      const latencyMs = Math.round(performance.now() - start);
      logger.warn('Tool permission denied', { tool: 'memory_store', latencyMs, reason: permission.reason });
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
    }
    const result = await memoryStoreTool({ content, priority, project_tags, anchored, expires_in_hours, updated_by, user_id, agent_id, project_id });
    executeAfterChain('memory_store', { content, priority }, result).catch(() => {});
    const latencyMs = Math.round(performance.now() - start);
    logger.info('Tool completed', { tool: 'memory_store', latencyMs, success: true });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    logger.error('Tool failed', { tool: 'memory_store', latencyMs, success: false, error });
    throw error;
  }
});

// Tool: memory_recall
mcpServer.registerTool('memory_recall', {
  description: 'Recall memories with automatic search mode detection',
  inputSchema: {
    query: z.string().describe('Search query for memories'),
    project_tags: z.array(z.string()).optional().describe('Filter by project tags'),
    limit: z.number().int().positive().optional().default(10).describe('Maximum results'),
    search_mode: z.enum(['keyword', 'semantic', 'hybrid', 'auto']).optional().default('auto').describe('Search mode'),
    user_id: z.string().optional().default('default').describe('User ID for storage isolation'),
    agent_id: z.string().optional().default('default').describe('Agent ID for storage isolation'),
    project_id: z.string().optional().default('default').describe('Project ID for storage isolation')
  }
}, async ({ query, project_tags, limit, search_mode, user_id, agent_id, project_id }) => {
  const result = await memoryRecallTool({ query, project_tags, limit, search_mode, user_id, agent_id, project_id });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_anchor
mcpServer.registerTool('memory_anchor', {
  description: 'Anchor a memory to make it permanent (never compressed)',
  inputSchema: {
    memory_id: z.string().uuid().describe('The memory ID to anchor'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ memory_id, token }) => {
  const permission = checkPermission('memory_anchor', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await memoryAnchorTool({ memory_id });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_report_usage
mcpServer.registerTool('memory_report_usage', {
  description: 'Report token usage and get compression recommendation',
  inputSchema: {
    used_tokens: z.number().min(0).describe('Current token usage'),
    max_tokens: z.number().min(1).describe('Maximum token limit')
  }
}, async ({ used_tokens, max_tokens }) => {
  const result = await memoryReportUsageTool({ used_tokens, max_tokens });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: context_compress
mcpServer.registerTool('context_compress', {
  description: 'Compress low-priority memories to reduce context size',
  inputSchema: {
    target_ratio: z.number().min(0).max(1).optional().describe('Target compression ratio (0-1)'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ target_ratio, token }) => {
  const permission = checkPermission('context_compress', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await contextCompressTool({ target_ratio });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: project_create
mcpServer.registerTool('project_create', {
  description: 'Create a new project for organizing memories',
  inputSchema: {
    name: z.string().min(1).describe('Project name'),
    root_path: z.string().optional().describe('Root path of the project'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ name, root_path, token }) => {
  const permission = checkPermission('project_create', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await projectCreateTool({ name, root_path });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_store_batch
mcpServer.registerTool('memory_store_batch', {
  description: 'Store multiple memories in one call (up to 100)',
  inputSchema: {
    memories: z.array(z.object({
      content: z.string().min(1).describe('Memory content'),
      priority: z.enum(['anchored', 'constraint', 'decision', 'preference', 'fact']).describe('Priority'),
      project_tags: z.array(z.string()).optional().describe('Project tags'),
      anchored: z.boolean().optional().describe('Anchored'),
      expires_in_hours: z.number().positive().optional().describe('TTL in hours')
    })).min(1).max(100).describe('Array of memories to store'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ memories, token }) => {
  const permission = checkPermission('memory_store_batch', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await memoryStoreBatchTool({ memories });
  executeAfterChain('memory_store_batch', { count: memories.length }, result).catch(() => {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_delete_batch
mcpServer.registerTool('memory_delete_batch', {
  description: 'Delete multiple memories in one call',
  inputSchema: {
    memory_ids: z.array(z.string().uuid()).min(1).max(100).describe('Memory IDs to delete'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ memory_ids, token }) => {
  const permission = checkPermission('memory_delete_batch', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await memoryDeleteBatchTool({ memory_ids });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_search
mcpServer.registerTool('memory_search', {
  description: 'Search memories with explicit search mode control',
  inputSchema: {
    query: z.string().describe('Search query'),
    project_tags: z.array(z.string()).optional().describe('Filter by project tags'),
    limit: z.number().int().positive().optional().default(10).describe('Max results'),
    search_mode: z.enum(['keyword', 'semantic', 'hybrid', 'auto']).optional().default('auto').describe('Search mode'),
    user_id: z.string().optional().default('default').describe('User ID for storage isolation'),
    agent_id: z.string().optional().default('default').describe('Agent ID for storage isolation'),
    project_id: z.string().optional().default('default').describe('Project ID for storage isolation')
  }
}, async ({ query, project_tags, limit, search_mode, user_id, agent_id, project_id }) => {
  const result = await memorySearchTool({ query, project_tags, limit, search_mode, user_id, agent_id, project_id });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: configure_llm
mcpServer.registerTool('configure_llm', {
  description: 'Configure LLM provider for summarization (OpenAI/Ollama/Anthropic)',
  inputSchema: {
    provider: z.enum(['openai', 'ollama', 'anthropic', 'none']).optional().describe('LLM provider'),
    api_key: z.string().optional().describe('API key'),
    base_url: z.string().optional().describe('Base URL for API'),
    model: z.string().optional().describe('Model name'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ provider, api_key, base_url, model, token }) => {
  const permission = checkPermission('configure_llm', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const result = await configureLLMTool({ provider, api_key, base_url, model });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: memory_stats
mcpServer.registerTool('memory_stats', {
  description: 'Get memory statistics and cleanup expired entries',
  inputSchema: {}
}, async () => {
  const result = await memoryStatsTool();
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Phase 1: AutoSkill-style Constraint Extraction ============

// Tool: memory_extract
mcpServer.registerTool('memory_extract', {
  description: 'Extract durable constraints from conversation turns (AutoSkill-style). Analyzes user turns to identify persistent preferences, constraints, and workflows. Only processes user messages, ignores one-shot requests.',
  inputSchema: {
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
  }
}, async ({ conversation_turns, project_tags, extract_mode, min_confidence, use_llm }) => {
  // 记录对话轮次，供 After-Chain 使用
  for (const turn of conversation_turns) {
    recordConversationTurn(turn.role, turn.content);
  }
  const result = await memoryExtractTool({
    conversation_turns,
    project_tags,
    extract_mode,
    min_confidence,
    use_llm,
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Phase 2: MemGate-style Intelligent Recall ============

// Tool: intelligent_recall
mcpServer.registerTool('intelligent_recall', {
  description: 'Recall memories with MemGate-style relevance scoring. Combines semantic similarity with learned relevance patterns, supports soft guidance injection and hard admissibility checking.',
  inputSchema: {
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
  }
}, async ({ 
  query, 
  conversation_context, 
  project_tags, 
  limit, 
  relevance_threshold, 
  return_mode, 
  enable_soft_guidance, 
  enable_hard_check 
}) => {
  const result = await intelligentRecallTool({ 
    query, 
    conversation_context, 
    project_tags, 
    limit, 
    relevance_threshold, 
    return_mode, 
    enable_soft_guidance, 
    enable_hard_check 
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Phase 3: MPR-style Dual-Mode Execution ============

// Tool: dual_mode_execute
mcpServer.registerTool('dual_mode_execute', {
  description: 'Dual-mode execution combining AutoSkill soft guidance with MPR hard admissibility. Validates proposed actions against stored constraints, injects relevant context, and returns decisions with suggestions.',
  inputSchema: {
    action: z.string().describe('Proposed action to validate'),
    context: z.string().describe('Current execution context'),
    project_tags: z.array(z.string()).optional().describe('Project tags for constraint lookup'),
    mode: z.enum(['soft_only', 'hard_only', 'dual']).optional().default('dual')
      .describe('Execution mode: soft (guidance), hard (check), or dual (both)'),
    soft_guidance_style: z.enum(['concise', 'detailed', 'minimal']).optional().default('concise')
      .describe('How much guidance to inject'),
    hard_threshold: z.number().min(0).max(1).optional().default(0.5)
      .describe('Threshold for hard admissibility')
  }
}, async ({ 
  action, 
  context, 
  project_tags, 
  mode, 
  soft_guidance_style, 
  hard_threshold 
}) => {
  const result = await dualModeExecuteTool({ 
    action, 
    context, 
    project_tags, 
    mode, 
    soft_guidance_style, 
    hard_threshold 
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Infrastructure: Database Management ============

// Tool: db_flush
mcpServer.registerTool('db_flush', {
  description: 'Manually flush the in-memory database to disk',
  inputSchema: {
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ token }) => {
  const permission = checkPermission('configure_llm', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const { flushDatabase, getDbPath } = await import('../utils/db.js');
  const before = process.hrtime.bigint();
  flushDatabase();
  const after = process.hrtime.bigint();
  return { content: [{ type: 'text', text: JSON.stringify({
    success: true,
    db_path: getDbPath(),
    flushed_at: new Date().toISOString(),
    duration_ms: Number(after - before) / 1_000_000
  }) }] };
});

// ============ Watchdog Permission Management ============

// Tool: watchdog_manage
mcpServer.registerTool('watchdog_manage', {
  description: 'Manage Watchdog tokens, generate new tokens, and check permissions',
  inputSchema: {
    action: z.enum(['generate_token', 'set_token', 'check_permission', 'list_tools', 'get_config']).describe('Action to perform'),
    token_type: z.enum(['read', 'write', 'watchdog']).optional().describe('Token type for generate/set'),
    token: z.string().optional().describe('Token value for set_token, or token to check for check_permission'),
    tool_name: z.string().optional().describe('Tool name for check_permission')
  }
}, async ({ action, token_type, token, tool_name }) => {
  const manager = getWatchdogTokenManager();

  switch (action) {
    case 'generate_token': {
      if (!token_type) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'token_type required for generate_token' }) }] };
      }
      const newToken = WatchdogTokenManager.generateToken();
      manager.setToken(token_type, newToken);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, token_type, token: newToken, warning: 'Store this token securely - it will not be shown again' }) }] };
    }
    case 'set_token': {
      if (!token_type || !token) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'token_type and token required for set_token' }) }] };
      }
      manager.setToken(token_type, token);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, token_type }) }] };
    }
    case 'check_permission': {
      if (!tool_name || !token) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'tool_name and token required for check_permission' }) }] };
      }
      const result = checkPermission(tool_name, token);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'list_tools': {
      return { content: [{ type: 'text', text: JSON.stringify({
        read_tools: READ_ONLY_TOOLS,
        write_tools: READ_WRITE_TOOLS,
        total: TOOL_PERMISSIONS.length
      }) }] };
    }
    case 'get_config': {
      return { content: [{ type: 'text', text: JSON.stringify({
        has_tokens: manager.hasTokens(),
        token_configured: {
          read: !!process.env.CG_READ_TOKEN,
          write: !!process.env.CG_WRITE_TOKEN,
          watchdog: !!process.env.CG_WATCHDOG_TOKEN
        }
      }) }] };
    }
    default:
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
  }
});

// ============ Infrastructure: GDPR Compliance Tools ============

// Tool: gdpr_export
mcpServer.registerTool('gdpr_export', {
  description: 'Export all user data for GDPR compliance (Article 20 - Right to Data Portability)',
  inputSchema: {
    user_id: z.string().describe('User ID to export data for'),
    include_sessions: z.boolean().optional().default(true).describe('Include session data'),
    include_projects: z.boolean().optional().default(true).describe('Include project data'),
    include_knowledge_graph: z.boolean().optional().default(true).describe('Include knowledge graph data'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ user_id, include_sessions, include_projects, include_knowledge_graph, token }) => {
  const permission = checkPermission('gdpr_export', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const { exportUserData } = await import('../api/gdpr.js');
  const result = exportUserData(user_id, {
    includeSessions: include_sessions,
    includeProjects: include_projects,
    includeKnowledgeGraph: include_knowledge_graph
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: gdpr_delete
mcpServer.registerTool('gdpr_delete', {
  description: 'Delete all user data for GDPR compliance (Article 17 - Right to Erasure)',
  inputSchema: {
    user_id: z.string().describe('User ID to delete data for'),
    delete_sessions: z.boolean().optional().default(true).describe('Delete session data'),
    delete_projects: z.boolean().optional().default(false).describe('Delete project data'),
    delete_knowledge_graph: z.boolean().optional().default(true).describe('Delete knowledge graph data'),
    retain_anchored: z.boolean().optional().default(true).describe('Retain anchored memories'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ user_id, delete_sessions, delete_projects, delete_knowledge_graph, retain_anchored, token }) => {
  const permission = checkPermission('gdpr_delete', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const { deleteUserData } = await import('../api/gdpr.js');
  const result = deleteUserData(user_id, {
    deleteSessions: delete_sessions,
    deleteProjects: delete_projects,
    deleteKnowledgeGraph: delete_knowledge_graph,
    retainAnchored: retain_anchored
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: data_summary
mcpServer.registerTool('data_summary', {
  description: 'Get summary of user data storage',
  inputSchema: {
    user_id: z.string().describe('User ID to get summary for')
  }
}, async ({ user_id }) => {
  const { getUserDataSummary } = await import('../api/gdpr.js');
  const result = getUserDataSummary(user_id);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Session Management Tools ============

// Tool: session_store
mcpServer.registerTool('session_store', {
  description: 'Store a session-level memory (key-value with scope control)',
  inputSchema: {
    key: z.string().min(1).describe('Session memory key'),
    value: z.string().min(1).describe('Session memory value'),
    scope: z.enum(['session', 'short', 'long', 'archival']).optional().default('session')
      .describe('Scope: session (window-close release), short (hours), long (days), archival (permanent)'),
    expires_in_hours: z.number().positive().optional().describe('TTL in hours'),
    meta: z.record(z.string(), z.unknown()).optional().describe('Additional metadata'),
    user_id: z.string().optional().default('default'),
    agent_id: z.string().optional().default('default'),
    project_id: z.string().optional().default('default'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ key, value, scope, expires_in_hours, meta, user_id, agent_id, project_id, token }) => {
  const permission = checkPermission('memory_store', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const { memorySessionStoreTool } = await import('./tools/memory-session.js');
  const result = await memorySessionStoreTool({ key, value, scope: scope || 'session', expires_in_hours, meta, user_id, agent_id, project_id });
  executeAfterChain('session_store', { key, value, scope }, result).catch(() => {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: session_get
mcpServer.registerTool('session_get', {
  description: 'Get a session-level memory by key',
  inputSchema: {
    key: z.string().min(1).describe('Session memory key'),
    user_id: z.string().optional().default('default'),
    agent_id: z.string().optional().default('default'),
    project_id: z.string().optional().default('default'),
    scope: z.enum(['session', 'short', 'long', 'archival']).optional().default('session')
  }
}, async ({ key, user_id, agent_id, project_id, scope }) => {
  const { memorySessionGetTool } = await import('./tools/memory-session.js');
  const result = await memorySessionGetTool({ key, user_id, agent_id, project_id, scope: scope || 'session' });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: session_list
mcpServer.registerTool('session_list', {
  description: 'List all session-level memories',
  inputSchema: {
    user_id: z.string().optional().default('default'),
    agent_id: z.string().optional().default('default'),
    project_id: z.string().optional().default('default'),
    scope: z.enum(['session', 'short', 'long', 'archival']).optional(),
    limit: z.number().int().positive().optional().default(50)
  }
}, async ({ user_id, agent_id, project_id, scope, limit }) => {
  const { memorySessionListTool } = await import('./tools/memory-session.js');
  const result = await memorySessionListTool({ user_id, agent_id, project_id, scope, limit });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// Tool: session_delete
mcpServer.registerTool('session_delete', {
  description: 'Delete a session-level memory by key',
  inputSchema: {
    key: z.string().min(1).describe('Session memory key to delete'),
    user_id: z.string().optional().default('default'),
    agent_id: z.string().optional().default('default'),
    project_id: z.string().optional().default('default'),
    scope: z.enum(['session', 'short', 'long', 'archival']).optional().default('session'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ key, user_id, agent_id, project_id, scope, token }) => {
  const permission = checkPermission('memory_delete_batch', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }
  const { memorySessionDeleteTool } = await import('./tools/memory-session.js');
  const result = await memorySessionDeleteTool({ key, user_id, agent_id, project_id, scope: scope || 'session' });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});

// ============ Infrastructure: After-Chain Configuration ============

// Tool: after_chain_configure
mcpServer.registerTool('after_chain_configure', {
  description: 'Configure after-chain tool orchestration at runtime. Allows agents to register new chains, toggle chains on/off, set global enabled state, and list chains.',
  inputSchema: {
    action: z.enum(['list_chains', 'toggle_chain', 'set_global', 'register_chain', 'get_global_config']).describe('Action to perform'),
    chain_name: z.string().optional().describe('Chain name for toggle_chain and register_chain actions'),
    enabled: z.boolean().optional().describe('Enable/disable state for toggle_chain and set_global actions'),
    chain_config: z.object({
      name: z.string().describe('Chain name'),
      description: z.string().optional().describe('Chain description'),
      triggerTool: z.string().describe('Trigger tool name'),
      followupTool: z.string().describe('Followup tool name'),
      async: z.boolean().optional().default(true).describe('Async execution'),
      condition: z.string().optional().describe('Condition function as string (advanced)'),
    }).optional().describe('Chain config for register_chain action'),
    token: z.string().optional().describe('Watchdog token for write operations')
  }
}, async ({ action, chain_name, enabled, chain_config, token }) => {
  const permission = checkPermission('configure_llm', token || '');
  if (!permission.allowed) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: 'Permission denied', reason: permission.reason }) }] };
  }

  const registry = getAfterChainRegistry();

  switch (action) {
    case 'list_chains': {
      const chains = registry.getAllChains();
      return { content: [{ type: 'text', text: JSON.stringify({
        chains: chains.map(c => ({
          name: c.name,
          description: c.description,
          hooks: c.hooks.map(h => ({
            triggerTool: h.triggerTool,
            followupTool: h.followupTool,
            async: h.async,
            enabled: h.enabled,
          })),
        })),
        total: chains.length,
      }) }] };
    }
    case 'toggle_chain': {
      if (!chain_name || enabled === undefined) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'chain_name and enabled required for toggle_chain' }) }] };
      }
      const success = registry.toggleChain(chain_name, enabled);
      return { content: [{ type: 'text', text: JSON.stringify({ success, chain_name, enabled }) }] };
    }
    case 'set_global': {
      if (enabled === undefined) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'enabled required for set_global' }) }] };
      }
      registry.updateGlobalConfig({ enabled });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, global_enabled: enabled }) }] };
    }
    case 'register_chain': {
      if (!chain_config) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'chain_config required for register_chain' }) }] };
      }
      registry.registerChain({
        name: chain_config.name,
        description: chain_config.description,
        hooks: [{
          triggerTool: chain_config.triggerTool as import('../utils/after-chain.js').ToolName,
          followupTool: chain_config.followupTool as import('../utils/after-chain.js').ToolName,
          async: chain_config.async ?? true,
          enabled: true,
        }],
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, chain_name: chain_config.name }) }] };
    }
    case 'get_global_config': {
      const config = registry.getGlobalConfig();
      return { content: [{ type: 'text', text: JSON.stringify(config) }] };
    }
    default:
      return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
  }
});

// Export for testing
export { mcpServer };

/**
 * Main entry point - start the MCP server
 */
export async function runServer(): Promise<void> {
  await initialize();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  logger.info('Context Gatekeeper MCP server running on stdio');
}

runServer().catch(error => {
  logger.error('Server error', { error });
  process.exit(1);
});
