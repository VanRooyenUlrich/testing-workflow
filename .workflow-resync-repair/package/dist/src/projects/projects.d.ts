import type { ProjectEntry, ProjectRegistry } from '../shared/types.js';
export declare function createProjectRegistry(gitRoot: string, entries: ProjectEntry[]): ProjectRegistry;
export declare function findProject(registry: ProjectRegistry, id: string): ProjectEntry;
export declare function validateProjectFilesystem(gitRoot: string, registry: ProjectRegistry): Promise<ProjectRegistry>;
//# sourceMappingURL=projects.d.ts.map