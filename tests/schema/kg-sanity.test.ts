import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase, query } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { createRelation, createFact } from '../../src/schema/knowledge-graph.js';

describe('KG sanity', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  it('dumps schema', () => {
    const tables = query<any[]>("SELECT name, sql FROM sqlite_master WHERE type='table'");
    console.log(tables.map(t => `${t.name}: ${t.sql}`).join('\n'));
  });

  it('creates a fact', () => {
    const e1 = createRelation({ sourceEntityId: 'e1', targetEntityId: 'e2', relationType: 'knows' });
    const f = createFact({ entityId: 'e1', relationId: e1.id, predicate: 'knows', value: 'e2' });
    expect(f.id).toBeDefined();
  });
});
