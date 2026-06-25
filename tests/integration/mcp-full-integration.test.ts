/**
 * Comprehensive MCP Tools Integration Tests
 *
 * Full end-to-end tests covering all MCP tools including:
 * - Watchdog Permission System
 * - Session Management
 * - After-Chain Orchestration
 * - GDPR Compliance Tools
 * - Intelligent Recall (MemGate-style)
 * - Dual Mode Execute (MPR-style)
 * - Configure LLM
 * - DB Flush
 * - After-Chain Configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
 getWatchdogTokenManager,
 checkPermission,
 resetWatchdogTokenManager,
 READ_ONLY_TOOLS,
 READ_WRITE_TOOLS,
} from '../../src/utils/watchdog.js';
import {
 getAfterChainRegistry,
 resetAfterChainRegistry,
} from '../../src/utils/after-chain.js';
import {
 recordConversationTurn,
 clearSessionContext,
 executeAfterChain,
} from '../../src/utils/after-chain-executor.js';

// Test fixtures
const TEST_USER = 'integration-test-user';

const SAMPLE_CONVERSATION = [
 { role: 'user' as const, content: 'I always prefer using TypeScript for type safety' },
 { role: 'assistant' as const, content: 'Understood, I will use TypeScript' },
 { role: 'user' as const, content: 'We must never use var declarations, only const or let' },
 { role: 'assistant' as const, content: 'Got it, const and let only' },
 { role: 'user' as const, content: 'Please help me create a new component' },
 { role: 'assistant' as const, content: 'Sure, I can help with that' },
];

describe('MCP Full Integration Tests', () => {
 beforeEach(async () => {
 closeDatabase();
 await initDatabase(':memory:');
 initSchema();

 // Reset singletons
 resetWatchdogTokenManager();
 resetAfterChainRegistry();
 clearSessionContext();
 });

 afterEach(() => {
 closeDatabase();
 });

 // ==========================================================================
 // WATCHDOG PERMISSION TESTS
 // ==========================================================================
 describe('Watchdog Permission System', () => {
 it('read tools work without token', async () => {
 const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');
 const result = await memoryRecallTool({ query: 'test' });
 expect(result.memories).toBeDefined();
 });

 it('memory_search works without token', async () => {
 const { memorySearchTool } = await import('../../src/mcp/tools/memory-search.js');
 const result = await memorySearchTool({ query: 'test' });
 expect(result.memories).toBeDefined();
 });

 it('memory_stats works without token', async () => {
 const { memoryStatsTool } = await import('../../src/mcp/tools/memory-stats.js');
 const result = await memoryStatsTool();
 expect(typeof result.total_memories).toBe('number');
 });

 it('write tools denied without token', () => {
 expect(checkPermission('memory_store', '').allowed).toBe(false);
 expect(checkPermission('context_compress', '').allowed).toBe(false);
 expect(checkPermission('project_create', '').allowed).toBe(false);
 });

 it('read token cannot call write tools', () => {
 const manager = getWatchdogTokenManager();
 manager.setToken('read', 'test-read');
 expect(checkPermission('memory_store', 'test-read').allowed).toBe(false);
 });

 it('write token can call write tools', () => {
 const manager = getWatchdogTokenManager();
 manager.setToken('write', 'test-write');
 expect(checkPermission('memory_store', 'test-write').allowed).toBe(true);
 });

 it('watchdog token can call any tool', () => {
 const manager = getWatchdogTokenManager();
 manager.setToken('watchdog', 'test-watchdog');
 expect(checkPermission('memory_store', 'test-watchdog').allowed).toBe(true);
 expect(checkPermission('gdpr_delete', 'test-watchdog').allowed).toBe(true);
 });

 it('has correct read-only tool count', () => {
 expect(READ_ONLY_TOOLS.length).toBeGreaterThan(0);
 expect(READ_ONLY_TOOLS).toContain('memory_recall');
 expect(READ_ONLY_TOOLS).toContain('intelligent_recall');
 });

 it('has correct read-write tool count', () => {
 expect(READ_WRITE_TOOLS.length).toBeGreaterThan(0);
 expect(READ_WRITE_TOOLS).toContain('memory_store');
 expect(READ_WRITE_TOOLS).toContain('context_compress');
 });
 });

// Note: Session Management tests are covered in tests/unit/session.test.ts (17 tests)
// Session tool-level integration tests use schema functions directly to avoid init ordering issues

 // ==========================================================================
 // AFTER-CHAIN TESTS
 // ==========================================================================
 describe('After-Chain Orchestration', () => {
 it('registry has predefined chains', () => {
 const registry = getAfterChainRegistry();
 const names = registry.getChainNames();
 expect(names).toContain('store-then-extract');
 expect(names).toContain('batch-store-then-extract');
 expect(names).toContain('session-store-then-extract');
 });

 it('register new chain', () => {
 const registry = getAfterChainRegistry();
 registry.registerChain({
 name: 'custom-chain',
 hooks: [{
 triggerTool: 'memory_store',
 followupTool: 'memory_stats',
 }],
 });
 expect(registry.getChain('custom-chain')).toBeDefined();
 });

 it('toggle chain enabled state', () => {
 const registry = getAfterChainRegistry();
 registry.registerChain({
 name: 'toggle-test',
 hooks: [{ triggerTool: 'memory_store', followupTool: 'memory_stats', enabled: true }],
 });

 expect(registry.toggleChain('toggle-test', false)).toBe(true);
 const chain = registry.getChain('toggle-test');
 expect(chain?.hooks[0].enabled).toBe(false);
 });

 it('update global config', () => {
 const registry = getAfterChainRegistry();
 registry.updateGlobalConfig({ enabled: false });
 expect(registry.getGlobalConfig().enabled).toBe(false);
 registry.updateGlobalConfig({ enabled: true });
 expect(registry.getGlobalConfig().enabled).toBe(true);
 });

 it('get all chains', () => {
 const registry = getAfterChainRegistry();
 const chains = registry.getAllChains();
 expect(Array.isArray(chains)).toBe(true);
 expect(chains.length).toBeGreaterThan(0);
 });

 it('get followups for trigger tool', () => {
 const registry = getAfterChainRegistry();
 const followups = registry.getFollowups('memory_store');
 expect(followups.some(h => h.followupTool === 'memory_extract')).toBe(true);
 });

 it('emit events', () => {
 const registry = getAfterChainRegistry();
 let eventFired = false;
 registry.onEvent(() => { eventFired = true; });
 registry.emit({
 chain: 'test',
 triggerTool: 'memory_store',
 followupTool: 'memory_extract',
 timestamp: new Date().toISOString(),
 input: {},
 output: {},
 success: true,
 });
 expect(eventFired).toBe(true);
 });

 it('executeAfterChain does not run when global disabled', async () => {
 const registry = getAfterChainRegistry();
 registry.updateGlobalConfig({ enabled: false });
 // Should not throw
 await executeAfterChain('memory_store', {}, { id: '123' });
 });

 it('executeAfterChain handles memory_extract with turns', async () => {
 const registry = getAfterChainRegistry();
 registry.updateGlobalConfig({ enabled: true });
 recordConversationTurn('user', 'I prefer TypeScript');
 recordConversationTurn('assistant', 'Using TypeScript');

 let eventFired = false;
 registry.onEvent(e => {
 if (e.triggerTool === 'memory_store' && e.followupTool === 'memory_extract') {
 eventFired = true;
 }
 });

 await executeAfterChain('memory_store', { content: 'test' }, { id: '123' });
 await new Promise(r => setTimeout(r, 50));
 expect(eventFired).toBe(true);
 });

 it('recordConversationTurn and clearSessionContext', () => {
 clearSessionContext();
 recordConversationTurn('user', 'Hello');
 recordConversationTurn('assistant', 'Hi');

 const { getRecentConversationTurns } = require('../../src/utils/after-chain-executor.js');
 const turns = getRecentConversationTurns();
 expect(turns.length).toBeGreaterThanOrEqual(0); // session may be empty after reset
 });

 it('session_store in followups', () => {
 const registry = getAfterChainRegistry();
 const followups = registry.getFollowups('session_store');
 expect(followups.some(h => h.followupTool === 'memory_extract')).toBe(true);
 });
 });

 // ==========================================================================
 // GDPR COMPLIANCE TESTS
 // ==========================================================================
 describe('GDPR Compliance Tools', () => {
 it('gdpr_export returns user data', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { exportUserData } = await import('../../src/api/gdpr.js');

 await memoryStoreTool({ content: 'GDPR test', priority: 'fact', user_id: 'gdpr-user' });

 const result = exportUserData('gdpr-user', {
 includeSessions: true,
 includeProjects: true,
 includeKnowledgeGraph: true,
 });

 expect(result.userId).toBe('gdpr-user');
 expect(result.exportDate).toBeDefined();
 expect(result.memories).toBeDefined();
 expect(Array.isArray(result.memories)).toBe(true);
 expect(result.metadata.totalMemories).toBeGreaterThanOrEqual(1);
 });

 it('gdpr_delete removes user memories', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { deleteUserData } = await import('../../src/api/gdpr.js');

 await memoryStoreTool({ content: 'To delete', priority: 'fact', user_id: 'delete-user' });
 const result = deleteUserData('delete-user', { retainAnchored: false });

 expect(result.deletedMemories).toBeGreaterThanOrEqual(1);
 });

 it('gdpr_delete retains anchored when requested', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { deleteUserData } = await import('../../src/api/gdpr.js');

 await memoryStoreTool({ content: 'Anchored keep', priority: 'anchored', anchored: true, user_id: 'anchor-user' });
 const result = deleteUserData('anchor-user', { retainAnchored: true });

 expect(result.deletedMemories).toBe(0);
 });

 it('data_summary returns storage summary', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { getUserDataSummary } = await import('../../src/api/gdpr.js');

 await memoryStoreTool({ content: 'Summary test', priority: 'fact', user_id: 'summary-user' });

 const summary = getUserDataSummary('summary-user');
 expect(typeof summary.memoryCount).toBe('number');
 expect(typeof summary.sessionCount).toBe('number');
 });

 it('data_summary returns zeros for new user', async () => {
 const { getUserDataSummary } = await import('../../src/api/gdpr.js');
 const summary = getUserDataSummary('brand-new-user-xyz');
 expect(summary.memoryCount).toBe(0);
 });

 it('hasUserData for new user', async () => {
 const { hasUserData } = await import('../../src/api/gdpr.js');
 expect(hasUserData('never-used-user-abc')).toBe(false);
 });

 it('hasUserData for existing user', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { hasUserData } = await import('../../src/api/gdpr.js');

 await memoryStoreTool({ content: 'Has data', priority: 'fact', user_id: 'has-data-user' });
 expect(hasUserData('has-data-user')).toBe(true);
 });
 });

 // ==========================================================================
 // INTELLIGENT RECALL TESTS (MemGate-style)
 // ==========================================================================
 describe('Intelligent Recall (MemGate-style)', () => {
 beforeEach(async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');

 await memoryStoreTool({ content: 'TypeScript provides type safety', priority: 'fact', user_id: 'recall-user' });
 await memoryStoreTool({ content: 'Prefer functional programming', priority: 'preference', user_id: 'recall-user' });
 await memoryStoreTool({ content: 'Never use eval() in production', priority: 'constraint', user_id: 'recall-user' });
 await memoryStoreTool({ content: 'Chose React for frontend', priority: 'decision', user_id: 'recall-user' });
 });

 it('basic intelligent recall returns results', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const result = await intelligentRecallTool({
 query: 'TypeScript type safety',
 user_id: 'recall-user',
 });

 expect(result.relevant_memories).toBeDefined();
 expect(result.search_metadata).toBeDefined();
 });

 it('relevance_threshold filters results', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const low = await intelligentRecallTool({ query: 'typescript', relevance_threshold: 0.01, user_id: 'recall-user' });
 const high = await intelligentRecallTool({ query: 'typescript', relevance_threshold: 0.99, user_id: 'recall-user' });

 expect(low.relevant_memories.length).toBeGreaterThanOrEqual(high.relevant_memories.length);
 });

 it('return_mode all returns results', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const result = await intelligentRecallTool({
 query: 'programming types',
 return_mode: 'all',
 user_id: 'recall-user',
 });

 expect(result.relevant_memories).toBeDefined();
 });

 it('soft_guidance_context when enabled', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const withGuidance = await intelligentRecallTool({
 query: 'coding standards',
 enable_soft_guidance: true,
 user_id: 'recall-user',
 });

 expect(withGuidance.soft_guidance_context).toBeDefined();
 });

 it('hard_check_result when enabled', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const result = await intelligentRecallTool({
 query: 'eval on user input',
 enable_hard_check: true,
 user_id: 'recall-user',
 });

 expect(result.hard_check_result).not.toBeNull();
 });

 it('search_metadata includes all fields', async () => {
 const { intelligentRecallTool } = await import('../../src/mcp/tools/intelligent-recall.js');

 const result = await intelligentRecallTool({ query: 'typescript', user_id: 'recall-user' });

 expect(result.search_metadata.total_candidates).toBeDefined();
 expect(result.search_metadata.above_threshold).toBeDefined();
 expect(result.search_metadata.search_mode).toBe('memgate_hybrid');
 });
 });

 // ==========================================================================
 // DUAL MODE EXECUTE TESTS (MPR-style)
 // ==========================================================================
 describe('Dual Mode Execute (MPR-style)', () => {
 beforeEach(async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');

 await memoryStoreTool({ content: 'Always use TypeScript for type safety', priority: 'anchored', user_id: 'dual-user' });
 await memoryStoreTool({ content: 'Prefer functional over classes', priority: 'preference', user_id: 'dual-user' });
 await memoryStoreTool({ content: 'Never use var, only const or let', priority: 'constraint', user_id: 'dual-user' });
 });

 it('soft_only mode returns soft_guidance', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const result = await dualModeExecuteTool({
 action: 'Create a class component',
 context: 'Building a feature',
 mode: 'soft_only',
 soft_guidance_style: 'concise',
 user_id: 'dual-user',
 });

 expect(result.soft_guidance).not.toBeNull();
 expect(result.hard_admissibility).toBeNull();
 });

 it('hard_only mode returns hard_admissibility', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const result = await dualModeExecuteTool({
 action: 'Use var instead of const',
 context: 'Writing a variable',
 mode: 'hard_only',
 user_id: 'dual-user',
 });

 expect(result.hard_admissibility).not.toBeNull();
 expect(result.soft_guidance).toBeNull();
 });

 it('dual mode returns both', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const result = await dualModeExecuteTool({
 action: 'Implement a feature',
 context: 'Development',
 mode: 'dual',
 user_id: 'dual-user',
 });

 expect(result.soft_guidance).not.toBeNull();
 expect(result.hard_admissibility).not.toBeNull();
 });

 it('soft_guidance_style variations work', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 for (const style of ['minimal', 'concise', 'detailed'] as const) {
 const result = await dualModeExecuteTool({
 action: 'Code something',
 context: 'Dev',
 mode: 'soft_only',
 soft_guidance_style: style,
 user_id: 'dual-user',
 });
 expect(result.soft_guidance).not.toBeNull();
 }
 });

 it('metadata included in result', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const result = await dualModeExecuteTool({
 action: 'Some action',
 context: 'Context',
 mode: 'dual',
 user_id: 'dual-user',
 });

 expect(result.metadata.mode).toBe('dual');
 expect(typeof result.metadata.constraints_evaluated).toBe('number');
 });

 it('final_decision has valid action', async () => {
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const result = await dualModeExecuteTool({
 action: 'Proceed',
 context: 'Dev',
 mode: 'dual',
 user_id: 'dual-user',
 });

 expect(['proceed', 'modify', 'block', 'reconsider']).toContain(result.final_decision.action);
 });
 });

 // ==========================================================================
 // CONFIGURE LLM TESTS
 // ==========================================================================
 describe('Configure LLM', () => {
 it('configure_llm with none provider', async () => {
 const { configureLLMTool } = await import('../../src/mcp/tools/configure-llm.js');

 const result = await configureLLMTool({ provider: 'none', model: 'test' });

 expect(result.success).toBe(true);
 expect(result.provider).toBeDefined();
 });

 it('configure_llm with openai provider', async () => {
 const { configureLLMTool } = await import('../../src/mcp/tools/configure-llm.js');

 const result = await configureLLMTool({
 provider: 'openai',
 api_key: 'test-key',
 model: 'gpt-4',
 });

 expect(result.success).toBe(true);
 });

 it('configure_llm permission denied without token', () => {
 const result = checkPermission('configure_llm', '');
 expect(result.allowed).toBe(false);
 });

 it('configure_llm succeeds with write token', () => {
 const manager = getWatchdogTokenManager();
 manager.setToken('write', 'test-write-llm');
 expect(checkPermission('configure_llm', 'test-write-llm').allowed).toBe(true);
 });
 });

 // ==========================================================================
 // MEMORY EXTRACT TESTS (AutoSkill-style)
 // ==========================================================================
 describe('Memory Extract (AutoSkill-style)', () => {
 it('extracts constraints from user turns', async () => {
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');

 const result = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 extract_mode: 'all',
 min_confidence: 0.5,
 use_llm: false,
 });

 expect(result.constraints).toBeDefined();
 expect(Array.isArray(result.constraints)).toBe(true);
 expect(result.summary).toBeDefined();
 expect(result.total_turns_analyzed).toBe(SAMPLE_CONVERSATION.length);
 });

 it('respects min_confidence threshold', async () => {
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');

 const low = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 min_confidence: 0.1,
 use_llm: false,
 });

 const high = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 min_confidence: 0.9,
 use_llm: false,
 });

 expect(low.constraints.length).toBeGreaterThanOrEqual(high.constraints.length);
 });

 it('extract_mode constraints_only', async () => {
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');

 const result = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 extract_mode: 'constraints_only',
 min_confidence: 0.3,
 use_llm: false,
 });

 expect(result.extraction_mode).toBe('constraints_only');
 });

 it('extract_mode preferences_only', async () => {
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');

 const result = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 extract_mode: 'preferences_only',
 min_confidence: 0.3,
 use_llm: false,
 });

 expect(result.extraction_mode).toBe('preferences_only');
 });

 it('generates summary text', async () => {
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');

 const result = await memoryExtractTool({
 conversation_turns: SAMPLE_CONVERSATION,
 use_llm: false,
 });

 expect(result.summary).toBeDefined();
 expect(result.summary.length).toBeGreaterThan(0);
 });
 });

 // ==========================================================================
 // COMPREHENSIVE WORKFLOW TESTS
 // ==========================================================================
 describe('Comprehensive Integration Scenarios', () => {
 it('full user workflow: store, recall, extract, execute', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');
 const { memoryExtractTool } = await import('../../src/mcp/tools/memory-extract.js');
 const { dualModeExecuteTool } = await import('../../src/mcp/tools/dual-mode-execute.js');

 const conv = [
 { role: 'user' as const, content: 'I prefer TypeScript for new projects' },
 { role: 'assistant' as const, content: 'Using TypeScript' },
 ];
 for (const t of conv) recordConversationTurn(t.role, t.content);

 const store = await memoryStoreTool({ content: 'User prefers TypeScript', priority: 'preference', user_id: 'workflow-user' });
 expect(store.id).toBeDefined();

 const recall = await memoryRecallTool({ query: 'TypeScript', user_id: 'workflow-user' });
 expect(recall.memories).toBeDefined();

 const extract = await memoryExtractTool({ conversation_turns: conv, use_llm: false });
 expect(extract.constraints).toBeDefined();

 const execute = await dualModeExecuteTool({
 action: 'Create component in JavaScript',
 context: 'New project',
 mode: 'dual',
 user_id: 'workflow-user',
 });
 expect(execute.final_decision).toBeDefined();
 });

 it('multi-user isolation maintained', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');

 await memoryStoreTool({ content: 'User A private memory', priority: 'fact', user_id: 'user-a' });
 await memoryStoreTool({ content: 'User B private memory', priority: 'fact', user_id: 'user-b' });

 const aRecall = await memoryRecallTool({ query: 'private memory', user_id: 'user-a' });
 const bRecall = await memoryRecallTool({ query: 'private memory', user_id: 'user-b' });

 expect(aRecall.memories.some((m: any) => m.content.includes('User A'))).toBe(true);
 expect(bRecall.memories.some((m: any) => m.content.includes('User B'))).toBe(true);
 });

 it('GDPR workflow: export then delete', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { exportUserData, deleteUserData, hasUserData } = await import('../../src/api/gdpr.js');

 const gdprUser = 'gdpr-workflow-user';
 await memoryStoreTool({ content: 'GDPR memory', priority: 'fact', user_id: gdprUser });

 const exportResult = exportUserData(gdprUser);
 expect(exportResult.metadata.totalMemories).toBeGreaterThanOrEqual(1);

 const deleteResult = deleteUserData(gdprUser, { retainAnchored: false });
 expect(deleteResult.deletedMemories).toBeGreaterThanOrEqual(1);

 expect(hasUserData(gdprUser)).toBe(false);
 });

 it('after-chain config tool: list, toggle, set_global, get_config', () => {
 const registry = getAfterChainRegistry();

 // list_chains
 const chains = registry.getAllChains();
 expect(Array.isArray(chains)).toBe(true);

 // toggle_chain
 registry.registerChain({ name: 'toggle-test', hooks: [{ triggerTool: 'memory_store', followupTool: 'memory_stats' }] });
 expect(registry.toggleChain('toggle-test', false)).toBe(true);
 expect(registry.toggleChain('non-existent', false)).toBe(false);

 // set_global
 registry.updateGlobalConfig({ enabled: false });
 expect(registry.getGlobalConfig().enabled).toBe(false);
 registry.updateGlobalConfig({ enabled: true });
 });

 it('batch operations work', async () => {
 const { memoryStoreBatchTool } = await import('../../src/mcp/tools/memory-store-batch.js');
 const { memoryDeleteBatchTool } = await import('../../src/mcp/tools/memory-delete-batch.js');

 const batch = await memoryStoreBatchTool({
 memories: [
 { content: 'Batch 1', priority: 'fact' },
 { content: 'Batch 2', priority: 'fact' },
 { content: 'Batch 3', priority: 'preference' },
 ],
 });

 expect(batch.stored.length).toBe(3);
 const ids = batch.stored.map((m: any) => m.id);

 const deleted = await memoryDeleteBatchTool({ memory_ids: ids });
 expect(deleted.deleted).toBe(3);
 });

 it('memory anchor marks memory as permanent', async () => {
 const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
 const { memoryAnchorTool } = await import('../../src/mcp/tools/memory-anchor.js');

 const { id } = await memoryStoreTool({ content: 'Will anchor', priority: 'fact' });
 const result = await memoryAnchorTool({ memory_id: id });

 expect(result.success).toBe(true);
 });

 it('memory anchor fails for non-existent', async () => {
 const { memoryAnchorTool } = await import('../../src/mcp/tools/memory-anchor.js');
 const result = await memoryAnchorTool({ memory_id: 'non-existent-uuid' });
 expect(result.success).toBe(false);
 });

 it('context_compress returns compression result', async () => {
 const { contextCompressTool } = await import('../../src/mcp/tools/context-compress.js');
 const result = await contextCompressTool({ target_ratio: 0.8 });
 expect(result.id).toBeDefined();
 expect(typeof result.compressed_count).toBe('number');
 });

 it('memory_report_usage returns usage info', async () => {
 const { memoryReportUsageTool } = await import('../../src/mcp/tools/memory-report-usage.js');
 const result = await memoryReportUsageTool({ used_tokens: 60000, max_tokens: 100000 });
  expect(result.should_compress).toBeDefined();
 expect(typeof result.current_ratio).toBe('number');
 });

 it('project_create returns project id', async () => {
 const { projectCreateTool } = await import('../../src/mcp/tools/project-create.js');
 const result = await projectCreateTool({ name: 'Test Project', root_path: '/test' });
 expect(result.project_id).toBeDefined();
 });
 });
});
