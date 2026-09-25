import type { AgentCapabilityManifest, ConfirmationInput, EnforcementEvidence, IsolationMode, WorkItem } from '../shared/types.js';
import type { Workflow } from '../work-items/workflow.js';
import { type Snapshot } from './files.js';
export interface SessionRecord {
    schemaVersion: 1;
    revision: number;
    id: string;
    workItem: string;
    project: string;
    repository: string;
    hostRoot: string;
    workspace: string;
    baselineContentRoot: string;
    mode: IsolationMode;
    governanceHash: string;
    registryHash: string;
    manifestHash: string;
    manifest: AgentCapabilityManifest;
    baseline: Snapshot;
    sourceBaseline?: Snapshot;
    expectedHost: Snapshot;
    expectedWorkspace: Snapshot;
    artifactsHash: string;
    approvalContextHash?: string;
    baselineCommit?: string;
    role: 'discovery' | 'specification' | 'planning' | 'implementation' | 'validation' | 'review';
    epoch: number;
    lifecycleState: WorkItem['state'];
    issuedAt: string;
    expiresAt: string;
    revokedAt?: string;
    revokedReason?: string;
    grants: {
        path: string;
        expiresAt: string;
        reason: string;
        actor: string;
    }[];
    validation?: {
        snapshotHash: string;
        governanceHash: string;
        passed: boolean;
        commands: string[];
        changedPaths?: string[];
        commandResults?: CommandReceipt[];
        resultHash?: string;
        validatedAt?: string;
    };
    handoff?: {
        contentHash: string;
        snapshotHash: string;
        governanceHash: string;
        manifestHash: string;
        submittedAt: string;
    };
    reviewSubmission?: {
        sourceSession: string;
        snapshotHash: string;
        governanceHash: string;
        manifestHash: string;
        findingsHash: string;
        handoffHash?: string;
        outcome: 'APPROVED' | 'CHANGES_REQUESTED';
        submittedAt: string;
        confirmationHash: string;
    };
    review?: {
        snapshotHash: string;
        reviewer: string;
        reviewSessionId: string;
        findingsHash: string;
        handoffHash?: string;
        approved: boolean;
        humanReviewed: boolean;
        confirmationHash: string;
    };
    promotion?: {
        confirmationHash: string;
        applied: boolean;
        receiptHash?: string;
        transactionId?: string;
        snapshotHash?: string;
        appliedAt?: string;
    };
    closed: boolean;
    runtime?: 'CONTAINER';
    reviewOf?: string;
}
export interface CommandReceipt {
    id: string;
    command: string;
    status: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
    exitCode: number | null;
    definitionHash: string;
    outputHash: string;
    logHash: string;
    logPath: string;
    startedAt: string;
    completedAt: string;
    sessionId: string;
    snapshotHash: string;
    governanceHash: string;
    manifestHash: string;
}
export interface SessionTransaction {
    schemaVersion: 1;
    transactionId: string;
    workItem: string;
    project: string;
    expectedRevision: number;
    expectedEpoch: number;
    newSession: {
        directory: string;
        id: string;
        epoch: number;
    };
    previousSession?: string;
    previousReviewSession?: string;
    state: 'INTENT' | 'SESSION_WRITTEN' | 'BOUND';
    createdAt: string;
}
export declare function sessionTransactionPath(root: string, workItem: string): string;
export declare class SessionStore {
    readonly directory: string;
    constructor(directory: string);
    read(): Promise<SessionRecord>;
    load(): Promise<SessionRecord>;
    save(state: SessionRecord): Promise<void>;
    exclusive<T>(operation: () => Promise<T>): Promise<T>;
}
export interface CurrentSession {
    store: SessionStore;
    state: SessionRecord;
    evidence: EnforcementEvidence;
}
export declare function assertActiveSession(store: SessionStore, state: SessionRecord, item: WorkItem): void;
export declare function requireSession(workflow: Workflow, item: WorkItem, store: SessionStore, roles: SessionRecord['role'][]): Promise<CurrentSession>;
export declare function requireCurrentSession(workflow: Workflow, item: WorkItem, roles?: SessionRecord['role'][]): Promise<CurrentSession>;
export declare function refreshCurrentSession(workflow: Workflow, item: WorkItem, store: SessionStore, role?: SessionRecord['role']): Promise<SessionRecord>;
export declare function revokeSession(workflow: Workflow, store: SessionStore, reason: string): Promise<void>;
export declare function createSession(workflow: Workflow, workItem: string, options?: {
    mode?: IsolationMode;
    directory?: string;
    ttlMs?: number;
    seedStore?: SessionStore;
}): Promise<SessionStore>;
export declare function reviewSessionTtlMs(): number;
export declare function archiveSession(workflow: Workflow, store: SessionStore): Promise<string>;
export declare function checkDrift(workflow: Workflow, store: SessionStore, state: SessionRecord): Promise<void>;
export declare function resynchronize(workflow: Workflow, store: SessionStore, confirmation: ConfirmationInput): Promise<void>;
//# sourceMappingURL=session.d.ts.map