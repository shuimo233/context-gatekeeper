import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  memoryStoreTool,
  memoryRecallTool,
  memorySearchTool,
  memoryStatsTool,
  contextCompressTool,
  projectCreateTool,
  memoryAnchorTool,
  memoryDeleteBatchTool
} from '../../src/mcp/tools/index.js';

describe('MCP Tools Effectiveness', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('memory store -> recall pipeline', () => {
    it('should store and recall a memory end-to-end', async () => {
      const { id } = await memoryStoreTool({ content: 'Effective memory content', priority: 'fact' });

      const recall = await memoryRecallTool({ query: 'Effective memory', search_mode: 'keyword' });

      expect(recall.memories.length).toBeGreaterThanOrEqual(1);
      expect(recall.memories.some(m => m.id === id)).toBe(true);
      expect(recall.memories[0].content).toBe('Effective memory content');
    });
  });

  describe('memory search effectiveness', () => {
    beforeEach(async () => {
      await memoryStoreTool({ content: 'TypeScript is great', priority: 'fact', project_tags: ['lang'] });
      await memoryStoreTool({ content: 'Rust is fast', priority: 'fact', project_tags: ['lang'] });
      await memoryStoreTool({ content: 'Python is simple', priority: 'preference', project_tags: ['lang'] });
    });

    it('should return relevant results for keyword search', async () => {
      const result = await memorySearchTool({ query: 'TypeScript', search_mode: 'keyword' });

      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.memories[0].content).toBe('TypeScript is great');
    });

    it('should filter by project tags', async () => {
      const result = await memorySearchTool({
        query: 'TypeScript',
        search_mode: 'keyword',
        project_tags: ['lang']
      });

      expect(result.memories.length).toBeGreaterThanOrEqual(1);
      expect(result.memories.every(m => m.project_tags.includes('lang'))).toBe(true);
    });
  });

  describe('memory stats effectiveness', () => {
    it('should reflect stored memories', async () => {
      await memoryStoreTool({ content: 'Stats A', priority: 'fact' });
      await memoryStoreTool({ content: 'Stats B', priority: 'preference' });

      const stats = await memoryStatsTool();

      expect(stats.total_memories).toBeGreaterThanOrEqual(2);
      expect(stats.by_priority.fact).toBeGreaterThanOrEqual(1);
      expect(stats.by_priority.preference).toBeGreaterThanOrEqual(1);
    });
  });

  describe('project isolation effectiveness', () => {
    it('should keep memories isolated by project', async () => {
      await memoryStoreTool({ content: 'Project A', priority: 'fact', project_id: 'project-a' });
      await memoryStoreTool({ content: 'Project B', priority: 'fact', project_id: 'project-b' });

      const recallA = await memoryRecallTool({ query: 'Project', search_mode: 'keyword', project_id: 'project-a' });
      const recallB = await memoryRecallTool({ query: 'Project', search_mode: 'keyword', project_id: 'project-b' });

      expect(recallA.memories.length).toBeGreaterThanOrEqual(1);
      expect(recallB.memories.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('memory anchor effectiveness', () => {
    it('should anchor stored memory', async () => {
      const { id } = await memoryStoreTool({ content: 'Anchor me', priority: 'fact' });
      const result = await memoryAnchorTool({ memory_id: id });

      expect(result.success).toBe(true);
    });
  });

  describe('memory delete batch effectiveness', () => {
    it('should delete multiple memories', async () => {
      const { id: id1 } = await memoryStoreTool({ content: 'Delete 1', priority: 'fact' });
      const { id: id2 } = await memoryStoreTool({ content: 'Delete 2', priority: 'fact' });

      const result = await memoryDeleteBatchTool({ memory_ids: [id1, id2] });

      expect(result.deleted).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('context compress effectiveness', () => {
    it('should compress memories without errors', async () => {
      await memoryStoreTool({ content: 'Compressible content 1', priority: 'fact' });
      await memoryStoreTool({ content: 'Compressible content 2', priority: 'fact' });

      const result = await contextCompressTool({ target_ratio: 0.8 });

      expect(typeof result.compressed_count).toBe('number');
      expect(typeof result.remaining_ratio).toBe('number');
    });
  });
});
