import { type DetectionResult, type ToolchainConfiguration } from './detection.js';
import type { ProjectEntry, ProjectRegistry } from '../shared/types.js';
import type { RuntimeSettings } from './runtime.js';
export type InitAction = 'CREATE' | 'UNCHANGED' | 'MERGE' | 'REVIEW_PATCH' | 'SKIP_DIVERGENT' | 'UPDATE_DIVERGENT';
export interface InitOperation {
    path: string;
    action: InitAction;
    kind: 'project-registry' | 'application-governance' | 'agent-guidance' | 'provider-integration' | 'runtime-settings' | 'workflow-skill';
    targetContentSha256: string;
    currentContentSha256?: string;
    conflicts?: string[];
    patch?: string;
}
export interface InitResult {
    detection: DetectionResult;
    registry: ProjectRegistry;
    operations: InitOperation[];
    planHash: string;
    changed: boolean;
}
export interface InitializeOptions {
    cwd: string;
    projects: ProjectEntry[];
    dryRun: boolean;
    acceptedForceHash?: string;
    toolchains?: ToolchainConfiguration;
    runtime?: RuntimeSettings;
}
export declare function initialize(options: InitializeOptions): Promise<InitResult>;
//# sourceMappingURL=initialize.d.ts.map