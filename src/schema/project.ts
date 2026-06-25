import { v4 as uuidv4 } from 'uuid';
import { query, run } from '../utils/db.js';
import { Project, CreateProjectInput } from '../models/types.js';
import { DatabaseError, ProjectNotFoundError } from '../utils/errors.js';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string | null;
  created_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: new Date(row.created_at)
  };
}

export function createProject(input: CreateProjectInput): Project {
  const id = uuidv4();
  const now = new Date().toISOString();
  
  try {
    run(`
      INSERT INTO projects (id, name, root_path, created_at)
      VALUES (?, ?, ?, ?)
    `, [id, input.name, input.rootPath || null, now]);
    
    return getProject(id)!;
  } catch (error) {
    throw new DatabaseError('Failed to create project', error);
  }
}

export function getProject(id: string): Project | null {
  try {
    const results = query<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
    return results.length > 0 ? rowToProject(results[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get project', error);
  }
}

export function getProjectOrThrow(id: string): Project {
  const project = getProject(id);
  if (!project) {
    throw new ProjectNotFoundError(id);
  }
  return project;
}

export function getProjectByName(name: string): Project | null {
  try {
    const results = query<ProjectRow>('SELECT * FROM projects WHERE name = ?', [name]);
    return results.length > 0 ? rowToProject(results[0]) : null;
  } catch (error) {
    throw new DatabaseError('Failed to get project by name', error);
  }
}

export function listProjects(): Project[] {
  try {
    const rows = query<ProjectRow>('SELECT * FROM projects ORDER BY created_at DESC');
    return rows.map(rowToProject);
  } catch (error) {
    throw new DatabaseError('Failed to list projects', error);
  }
}

export function deleteProject(id: string): void {
  try {
    run('DELETE FROM projects WHERE id = ?', [id]);
  } catch (error) {
    throw new DatabaseError('Failed to delete project', error);
  }
}
