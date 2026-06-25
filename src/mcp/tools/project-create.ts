import { z } from 'zod';
import { createProject } from '../../schema/project.js';

export const ProjectCreateInput = z.object({
  name: z.string().min(1).describe('Project name'),
  root_path: z.string().optional().describe('Root path of the project')
});

export type ProjectCreateInputType = z.infer<typeof ProjectCreateInput>;

export async function projectCreateTool(input: ProjectCreateInputType): Promise<{ project_id: string }> {
  const project = createProject({
    name: input.name,
    rootPath: input.root_path
  });
  
  return { project_id: project.id };
}
