import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';

describe('MCP Tools Integration', () => {
  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
    
    // Suppress console noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('memory_store tool', () => {
    it('should store a memory', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      
      const result = await memoryStoreTool({
        content: 'Test memory',
        priority: 'fact'
      });

      expect(result.id).toBeDefined();
    });

    it('should store memory with isolation parameters', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      
      const result = await memoryStoreTool({
        content: 'Isolated memory',
        priority: 'fact',
        user_id: 'test-user',
        agent_id: 'test-agent',
        project_id: 'test-project'
      });

      expect(result.id).toBeDefined();
      // Note: Isolation filtering on getMemory uses the service's isolationContext
      // so direct retrieval may be limited by the default isolation context
    });

    it('should store memory with tags', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      
      const result = await memoryStoreTool({
        content: 'Tagged memory',
        priority: 'fact',
        project_tags: ['tag1', 'tag2']
      });

      expect(result.id).toBeDefined();
    });

    it('should store anchored memory', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      
      const result = await memoryStoreTool({
        content: 'Anchored memory',
        priority: 'fact',
        anchored: true
      });

      expect(result.id).toBeDefined();
    });
  });

  describe('memory_recall tool', () => {
    it('should recall memories', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');
      
      await memoryStoreTool({ content: 'Recall test', priority: 'fact' });
      
      const result = await memoryRecallTool({ query: 'Recall' });
      
      expect(result.memories).toBeDefined();
      expect(Array.isArray(result.memories)).toBe(true);
      expect(result.search_mode).toBeDefined();
    });

    it('should respect limit', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');
      
      for (let i = 0; i < 10; i++) {
        await memoryStoreTool({ content: `Memory ${i}`, priority: 'fact' });
      }
      
      const result = await memoryRecallTool({ query: 'Memory', limit: 3 });
      
      expect(result.memories.length).toBeLessThanOrEqual(3);
    });

    it('should support all search modes', async () => {
      const { memoryRecallTool } = await import('../../src/mcp/tools/memory-recall.js');
      
      const modes: Array<'keyword' | 'semantic' | 'hybrid' | 'auto'> = ['keyword', 'semantic', 'hybrid', 'auto'];
      
      for (const mode of modes) {
        const result = await memoryRecallTool({ query: 'test', search_mode: mode });
        expect(result.search_mode).toBe(mode);
      }
    });
  });

  describe('memory_search tool', () => {
    it('should search memories', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memorySearchTool } = await import('../../src/mcp/tools/memory-search.js');
      
      await memoryStoreTool({ content: 'Searchable content', priority: 'fact' });
      
      const result = await memorySearchTool({ query: 'Searchable' });
      
      expect(result.memories).toBeDefined();
      expect(result.memories.length).toBeGreaterThan(0);
    });
  });

  describe('memory_stats tool', () => {
    it('should return statistics', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memoryStatsTool } = await import('../../src/mcp/tools/memory-stats.js');
      
      await memoryStoreTool({ content: 'Stats test', priority: 'fact' });
      
      const stats = await memoryStatsTool();
      
      expect(stats.total_memories).toBeGreaterThan(0);
      expect(stats.by_priority).toBeDefined();
      expect(typeof stats.anchored_count).toBe('number');
    });
  });

  describe('context_compress tool', () => {
    it('should compress memories', async () => {
      const { contextCompressTool } = await import('../../src/mcp/tools/context-compress.js');
      
      const result = await contextCompressTool({ target_ratio: 0.8 });
      
      expect(result.id).toBeDefined();
      expect(typeof result.compressed_count).toBe('number');
      expect(typeof result.remaining_ratio).toBe('number');
    });
  });

  describe('project_create tool', () => {
    it('should create a project', async () => {
      const { projectCreateTool } = await import('../../src/mcp/tools/project-create.js');
      
      const result = await projectCreateTool({ name: 'Test Project' });
      
      expect(result.project_id).toBeDefined();
    });

    it('should create project with root path', async () => {
      const { projectCreateTool } = await import('../../src/mcp/tools/project-create.js');
      
      const result = await projectCreateTool({ 
        name: 'Path Project',
        root_path: '/test/path'
      });
      
      expect(result.project_id).toBeDefined();
    });
  });

  describe('memory_anchor tool', () => {
    it('should anchor a memory', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memoryAnchorTool } = await import('../../src/mcp/tools/memory-anchor.js');
      
      const { id } = await memoryStoreTool({ content: 'Will anchor', priority: 'fact' });
      
      const result = await memoryAnchorTool({ memory_id: id });
      
      expect(result.success).toBe(true);
    });

    it('should return failure for non-existent memory', async () => {
      const { memoryAnchorTool } = await import('../../src/mcp/tools/memory-anchor.js');
      
      const result = await memoryAnchorTool({ memory_id: 'non-existent-id' });
      
      expect(result.success).toBe(false);
    });
  });

  describe('memory_delete_batch tool', () => {
    it('should delete multiple memories', async () => {
      const { memoryStoreTool } = await import('../../src/mcp/tools/memory-store.js');
      const { memoryDeleteBatchTool } = await import('../../src/mcp/tools/memory-delete-batch.js');
      
      const { id: id1 } = await memoryStoreTool({ content: 'Delete 1', priority: 'fact' });
      const { id: id2 } = await memoryStoreTool({ content: 'Delete 2', priority: 'fact' });
      
      const result = await memoryDeleteBatchTool({ memory_ids: [id1, id2] });
      
      expect(result.deleted).toBe(2);
      expect(result.total).toBe(2);
    });
  });
});
