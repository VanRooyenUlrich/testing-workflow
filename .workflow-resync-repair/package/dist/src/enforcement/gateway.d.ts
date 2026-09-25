import type { Workflow } from '../work-items/workflow.js';
import { type SessionRecord, type SessionStore } from './session.js';
import { type PolicyAction, type PolicyEngine, type PolicyInput } from './policy.js';
import { ContainerRunner } from './containers.js';
export declare class PolicyGateway {
    readonly workflow: Workflow;
    readonly store: SessionStore;
    readonly policy: PolicyEngine;
    constructor(workflow: Workflow, store: SessionStore, policy: PolicyEngine);
    current(): Promise<SessionRecord>;
    input(action: PolicyAction, options?: {
        path?: string;
        command?: string;
        coreAllow?: boolean;
        confirmationRequired?: boolean;
    }): Promise<PolicyInput>;
    authorize(action: PolicyAction, options?: Parameters<PolicyGateway['input']>[1]): Promise<void>;
    audit(type: string, data: Record<string, string | number | boolean | string[] | undefined>): Promise<void>;
    read(path: string): Promise<{
        content: string;
        sha256: string;
    }>;
    list(): Promise<string[]>;
    search(query: string): Promise<{
        path: string;
        lines: number[];
    }[]>;
    mutate(operation: 'create' | 'replace' | 'delete', path: string, expected: string | null, content?: string): Promise<void>;
    submitHandoff(content: string): Promise<{
        recorded: true;
        contentHash: string;
        snapshotHash: string;
    }>;
    inspectChanges(): Promise<{
        path: string;
        before: string | null;
        after: string | null;
        diff: string;
    }[]>;
    private sourceBaseline;
    validate(runner?: ContainerRunner): Promise<{
        passed: boolean;
        changedPaths: string[];
        snapshotHash: string;
        resultHash: string;
    }>;
}
//# sourceMappingURL=gateway.d.ts.map