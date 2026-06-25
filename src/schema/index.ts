export { createMemory, getMemory, getMemoryOrThrow, updateMemory, deleteMemory, listMemories, searchMemories, incrementAccessCount, anchorMemory, getMemoriesByIds, storeEmbedding, getEmbedding, searchMemoriesBM25, searchMemoriesVector, searchMemoriesHybrid, cleanupExpiredMemories, buildIsolationFilter } from './memory.js';
export { createCompression, getCompression, getCompressionHistory, listCompressions, cleanupOldCompressions } from './compression.js';
export { createProject, getProject, getProjectOrThrow, getProjectByName, listProjects, deleteProject } from './project.js';
export { initSchema } from './schema-init.js';
export { ensureVectorIndexMetadata, registerVectorIndex, listVectorIndexes, removeVectorIndex } from './vector-index.js';
export { initFullTextSearch, searchFullText, rebuildFullTextIndex } from './fulltext-search.js';
export { initKnowledgeGraph, getEntity, createEntity, getRelationsByEntity, createRelation, getFactsByEntity, createFact, getKGStats, type KGEntity, type KGRelation, type KGFact, type KGExtractionResult } from './knowledge-graph.js';
export { extractTriplesFromMemory, extractTriplesFromMemories, extractTriplesFromConversation } from '../services/triple-extractor.js';
