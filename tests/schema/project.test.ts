import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabase, initDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import { createProject, getProject, listProjects, deleteProject } from '../../src/schema/project.js';

describe('Project Schema', () => {
  beforeEach(async () => {
    resetDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createProject', () => {
    it('should create a project', () => {
      const project = createProject({ name: 'Test Project', rootPath: '/test/path' });
      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.rootPath).toBe('/test/path');
    });

    it('should create project without root path', () => {
      const project = createProject({ name: 'Minimal Project' });
      expect(project.name).toBe('Minimal Project');
    });

    it('should enforce unique names', () => {
      createProject({ name: 'UniqueName' });
      expect(() => createProject({ name: 'UniqueName' })).toThrow();
    });
  });

  describe('getProject', () => {
    it('should retrieve existing project', () => {
      const created = createProject({ name: 'FindProject' });
      const found = getProject(created.id);
      expect(found).not.toBeNull();
      expect(found?.name).toBe('FindProject');
    });

    it('should return null for non-existent', () => {
      const found = getProject('proj-nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('listProjects', () => {
    it('should list all projects', () => {
      createProject({ name: 'Project A' });
      createProject({ name: 'Project B' });
      const projects = listProjects();
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteProject', () => {
    it('should delete project', () => {
      const project = createProject({ name: 'DeleteMe' });
      deleteProject(project.id);
      expect(getProject(project.id)).toBeNull();
    });

    it('should return false for non-existent', () => {
      expect(deleteProject('proj-nonexistent')).toBe(false);
    });
  });
});
