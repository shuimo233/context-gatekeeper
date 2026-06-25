import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, closeDatabase } from '../../src/utils/db.js';
import { initSchema } from '../../src/schema/schema-init.js';
import {
  createProject,
  getProject,
  getProjectOrThrow,
  getProjectByName,
  listProjects,
  deleteProject
} from '../../src/schema/project.js';
import { ProjectNotFoundError } from '../../src/utils/errors.js';

describe('Project Management', () => {
  beforeEach(async () => {
    closeDatabase();
    await initDatabase(':memory:');
    initSchema();
  });

  describe('createProject', () => {
    it('should create a project', () => {
      const project = createProject({ name: 'Test Project' });

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.rootPath).toBeNull();
    });

    it('should create project with root path', () => {
      const project = createProject({ 
        name: 'Path Project',
        rootPath: '/home/user/project'
      });

      expect(project.rootPath).toBe('/home/user/project');
    });
  });

  describe('getProject', () => {
    it('should retrieve a project', () => {
      const created = createProject({ name: 'Get Test' });
      const retrieved = getProject(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Get Test');
    });

    it('should return null for non-existent project', () => {
      const result = getProject('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getProjectOrThrow', () => {
    it('should return project when exists', () => {
      const created = createProject({ name: 'OrThrow Test' });
      const result = getProjectOrThrow(created.id);

      expect(result.name).toBe('OrThrow Test');
    });

    it('should throw when not found', () => {
      expect(() => getProjectOrThrow('non-existent')).toThrow(ProjectNotFoundError);
    });
  });

  describe('getProjectByName', () => {
    it('should find project by name', () => {
      createProject({ name: 'Unique Project Name' });
      const result = getProjectByName('Unique Project Name');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Unique Project Name');
    });

    it('should return null for non-existent name', () => {
      const result = getProjectByName('Non Existent');
      expect(result).toBeNull();
    });
  });

  describe('listProjects', () => {
    it('should list all projects', () => {
      createProject({ name: 'Project 1' });
      createProject({ name: 'Project 2' });

      const projects = listProjects();
      expect(projects.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('deleteProject', () => {
    it('should delete a project', () => {
      const created = createProject({ name: 'To Delete' });
      deleteProject(created.id);

      const result = getProject(created.id);
      expect(result).toBeNull();
    });
  });
});
