import type { ProjectGovernance } from '../shared/types.js';
export type Classification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export declare function mandatoryRestricted(path: string): boolean;
export declare function normalizePath(path: string): string;
export declare function within(root: string, target: string): boolean;
/** Reject every link, including Windows junctions, rather than trusting link targets. */
export declare function safePath(root: string, path: string, missingLeaf?: boolean): Promise<string>;
export declare function removeCreatedDirectories(root: string, directories: string[]): Promise<void>;
export declare function listFiles(root: string): Promise<string[]>;
export interface FileVersion {
    sha256: string;
    size: number;
}
export type Snapshot = Record<string, FileVersion>;
export declare function snapshot(root: string): Promise<Snapshot>;
export declare function changedPaths(before: Snapshot, after: Snapshot): string[];
export declare function classifiedScope(governance: ProjectGovernance, path: string): boolean;
export declare class GovernedFiles {
    readonly root: string;
    constructor(root: string);
    read(path: string): Promise<{
        content: string;
        sha256: string;
    }>;
    mutate(operation: 'create' | 'replace' | 'delete', path: string, expected: string | null, content?: string): Promise<{
        createdDirectories: string[];
    }>;
}
//# sourceMappingURL=files.d.ts.map