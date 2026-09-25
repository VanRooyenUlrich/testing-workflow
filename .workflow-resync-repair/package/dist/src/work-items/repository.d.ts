import type { ArtifactType, ProjectGovernance, ProjectRegistry, WorkItem } from '../shared/types.js';
export declare class WorkflowRepository {
    readonly gitRoot: string;
    constructor(gitRoot: string);
    registryPath(): string;
    evidencePath(): string;
    exclusiveCommit<T>(operation: () => Promise<T>): Promise<T>;
    workItemDirectory(id: string): string;
    loadRegistry(): Promise<ProjectRegistry>;
    saveRegistry(registry: ProjectRegistry): Promise<void>;
    loadGovernance(projectId: string): Promise<ProjectGovernance>;
    workItemPath(id: string): string;
    loadWorkItem(id: string): Promise<WorkItem>;
    listWorkItems(): Promise<WorkItem[]>;
    saveWorkItem(workItem: WorkItem): Promise<WorkItem>;
    saveWorkItemSnapshot(workItem: WorkItem): Promise<void>;
    artifactPath(id: string, type: ArtifactType): string;
    writeArtifact(id: string, type: ArtifactType, content: string): Promise<void>;
    readArtifact(id: string, type: ArtifactType): Promise<string>;
}
//# sourceMappingURL=repository.d.ts.map