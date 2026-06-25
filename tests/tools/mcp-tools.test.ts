import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { memoryStoreTool } from '../../src/mcp/tools/memory-store.js';
import { memoryRecallTool } from '../../src/mcp/tools/memory-recall.js';
import { memorySearchTool } from '../../src/mcp/tools/memory-search.js';
import { memoryStatsTool } from '../../src/mcp/tools/memory-stats.js';
import {
  getAfterChainRegistry,
  resetAfterChainRegistry,
  ChainConfig,
  ToolName,
} from '../../src/utils/after-chain.js';
import {
  executeAfterChain,
  recordConversationTurn,
  clearSessionContext,
  registerToolHandler,
} from '../../src/utils/after-chain-executor.js';

describe('MCP Tools', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('memoryStoreTool', () => {
    it('should store memory and return id', async () => {
      const result = await memoryStoreTool({
        content: 'Test memory from tool',
        priority: 'fact',
      });

      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
    });

    it('should store with all parameters', async () => {
      const result = await memoryStoreTool({
        content: 'Full memory',
        priority: 'preference',
        project_tags: ['test', 'mcp'],
        anchored: false,
        expires_in_hours: 24,
        updated_by: 'test-agent',
      });

      expect(result).toHaveProperty('id');
    });
  });

  describe('memoryRecallTool', () => {
    beforeEach(async () => {
      await memoryStoreTool({ content: 'TypeScript memory', priority: 'fact' });
      await memoryStoreTool({ content: 'Rust memory', priority: 'fact' });
    });

    it('should recall memories', async () => {
      const result = await memoryRecallTool({
        query: 'TypeScript',
        limit: 10,
        search_mode: 'keyword',
      });

      expect(result).toHaveProperty('memories');
      expect(result).toHaveProperty('search_mode');
      expect(Array.isArray(result.memories)).toBe(true);
    });

    it('should respect limit', async () => {
      const result = await memoryRecallTool({
        query: '',
        limit: 1,
        search_mode: 'keyword',
      });

      expect(result.memories.length).toBeLessThanOrEqual(1);
    });

    it('should support semantic search', async () => {
      const result = await memoryRecallTool({
        query: 'programming language',
        search_mode: 'semantic',
      });

      expect(result.search_mode).toBe('semantic');
    });

    it('should support hybrid search', async () => {
      const result = await memoryRecallTool({
        query: 'TypeScript',
        search_mode: 'hybrid',
      });

      expect(result.search_mode).toBe('hybrid');
    });
  });

  describe('memorySearchTool', () => {
    beforeEach(async () => {
      await memoryStoreTool({ content: 'Searchable content', priority: 'fact' });
    });

    it('should search memories', async () => {
      const result = await memorySearchTool({
        query: 'Searchable',
        search_mode: 'keyword',
      });

      expect(Array.isArray(result.memories)).toBe(true);
    });
  });

  describe('memoryStatsTool', () => {
    beforeEach(async () => {
      await memoryStoreTool({ content: 'Stats test 1', priority: 'fact' });
      await memoryStoreTool({ content: 'Stats test 2', priority: 'preference' });
    });

    it('should return statistics', async () => {
      const stats = await memoryStatsTool();

      expect(stats).toHaveProperty('total_memories');
      expect(stats).toHaveProperty('by_priority');
      expect(stats).toHaveProperty('anchored_count');
      expect(stats).toHaveProperty('total_content_tokens');
    });

    it('should count priorities correctly', async () => {
      const stats = await memoryStatsTool();
      expect(stats.by_priority.fact).toBeGreaterThanOrEqual(1);
      expect(stats.by_priority.preference).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============ After-Chain Tests ============

describe('After-Chain', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
    resetAfterChainRegistry();
    clearSessionContext();
  });

  describe('AfterChainRegistry', () => {
    it('should have predefined chains registered', () => {
      const registry = getAfterChainRegistry();
      const chainNames = registry.getChainNames();

      expect(chainNames).toContain('store-then-extract');
      expect(chainNames).toContain('batch-store-then-extract');
      expect(chainNames).toContain('session-store-then-extract');
    });

    it('should register new chain', () => {
      const registry = getAfterChainRegistry();
      const newChain: ChainConfig = {
        name: 'test-chain',
        description: 'Test chain',
        hooks: [{
          triggerTool: 'memory_store' as ToolName,
          followupTool: 'memory_stats' as ToolName,
          async: true,
          enabled: true,
        }],
      };

      registry.registerChain(newChain);
      expect(registry.getChain('test-chain')).toBeDefined();
    });

    it('should unregister chain', () => {
      const registry = getAfterChainRegistry();
      const newChain: ChainConfig = {
        name: 'temp-chain',
        hooks: [{
          triggerTool: 'memory_store' as ToolName,
          followupTool: 'memory_stats' as ToolName,
        }],
      };

      registry.registerChain(newChain);
      expect(registry.getChain('temp-chain')).toBeDefined();

      registry.unregisterChain('temp-chain');
      expect(registry.getChain('temp-chain')).toBeUndefined();
    });

    it('should toggle chain enabled state', () => {
      const registry = getAfterChainRegistry();
      const newChain: ChainConfig = {
        name: 'toggle-test',
        hooks: [{
          triggerTool: 'memory_store' as ToolName,
          followupTool: 'memory_stats' as ToolName,
          enabled: true,
        }],
      };

      registry.registerChain(newChain);
      const success = registry.toggleChain('toggle-test', false);
      expect(success).toBe(true);

      const chain = registry.getChain('toggle-test');
      expect(chain?.hooks[0].enabled).toBe(false);
    });

    it('should update global config', () => {
      const registry = getAfterChainRegistry();
      registry.updateGlobalConfig({ enabled: false });
      expect(registry.getGlobalConfig().enabled).toBe(false);

      registry.updateGlobalConfig({ enabled: true });
      expect(registry.getGlobalConfig().enabled).toBe(true);
    });

    it('should get all chains', () => {
      const registry = getAfterChainRegistry();
      const chains = registry.getAllChains();

      expect(Array.isArray(chains)).toBe(true);
      expect(chains.length).toBeGreaterThan(0);
    });

    it('should get followups for trigger tool', () => {
      const registry = getAfterChainRegistry();
      const followups = registry.getFollowups('memory_store');

      expect(Array.isArray(followups)).toBe(true);
      expect(followups.some(h => h.followupTool === 'memory_extract')).toBe(true);
    });

    it('should emit events', () => {
      const registry = getAfterChainRegistry();
      let eventReceived = false;

      registry.onEvent(() => {
        eventReceived = true;
      });

      registry.emit({
        chain: 'test',
        triggerTool: 'memory_store',
        followupTool: 'memory_extract',
        timestamp: new Date().toISOString(),
        input: {},
        output: {},
        success: true,
      });

      expect(eventReceived).toBe(true);
    });
  });

  describe('executeAfterChain', () => {
    it('should not execute when global disabled', async () => {
      const registry = getAfterChainRegistry();
      registry.updateGlobalConfig({ enabled: false });

      await executeAfterChain('memory_store', {}, { id: '123' });
      // Should not throw and should return early
    });

    it('should handle memory_extract followup', async () => {
      const registry = getAfterChainRegistry();
      registry.updateGlobalConfig({ enabled: true });

      // Add conversation turns
      recordConversationTurn('user', 'I prefer TypeScript');
      recordConversationTurn('assistant', 'Okay, I will use TypeScript');

      // memory_extract has built-in handling, so we test that events are emitted
      let eventEmitted = false;
      registry.onEvent((event) => {
        if (event.triggerTool === 'memory_store' && event.followupTool === 'memory_extract') {
          eventEmitted = true;
        }
      });

      await executeAfterChain('memory_store', { content: 'test' }, { id: '123' });

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(eventEmitted).toBe(true);
    });

    it('should skip when no conversation turns for memory_extract', async () => {
      clearSessionContext();
      const registry = getAfterChainRegistry();
      registry.updateGlobalConfig({ enabled: true });

      let eventEmitted = false;
      registry.onEvent((event) => {
        if (event.success === false && event.error) {
          eventEmitted = true;
        }
      });

      await executeAfterChain('memory_store', { content: 'test' }, { id: '123' });
      expect(eventEmitted).toBe(true);
    });

    it('should handle registered tool handlers', async () => {
      const registry = getAfterChainRegistry();
      registry.updateGlobalConfig({ enabled: true });

      // Register a custom handler
      registerToolHandler('memory_stats', async () => {
        return { total_memories: 0, by_priority: {} };
      });

      let handlerCalled = false;
      registry.onEvent(() => {
        handlerCalled = true;
      });

      await executeAfterChain('memory_store', { content: 'test' }, { id: '123' });
      expect(handlerCalled).toBe(true);
    });
  });

  describe('Session context', () => {
    it('should record conversation turns', async () => {
      clearSessionContext();

      recordConversationTurn('user', 'Hello');
      recordConversationTurn('assistant', 'Hi there');
      recordConversationTurn('user', 'How are you?');

      const { getRecentConversationTurns } = await import('../../src/utils/after-chain-executor.js');
      const recent = getRecentConversationTurns(2);
      expect(recent.length).toBeLessThanOrEqual(2);
    });

    it('should clear session context', async () => {
      recordConversationTurn('user', 'Test');
      clearSessionContext();

      const { getRecentConversationTurns } = await import('../../src/utils/after-chain-executor.js');
      const turns = getRecentConversationTurns();
      expect(turns.length).toBe(0);
    });
  });

  describe('ToolName type', () => {
    it('should include session tools', () => {
      const registry = getAfterChainRegistry();
      const followups = registry.getFollowups('session_store');

      expect(followups.some(h => h.followupTool === 'memory_extract')).toBe(true);
    });
  });
});
