export declare const lifecycleStates: readonly ["DISCOVERING", "SPEC_DRAFT", "SPEC_ACCEPTED", "PLANNING", "PLAN_APPROVED", "IMPLEMENTING", "VALIDATING", "READY_FOR_REVIEW", "COMPLETE"];
export type LifecycleState = (typeof lifecycleStates)[number];
export declare const riskProfiles: readonly ["LIGHTWEIGHT", "STANDARD", "HIGH_RISK"];
export type RiskProfile = (typeof riskProfiles)[number];
export declare const isolationModes: readonly ["HOST_WORKSPACE", "ISOLATED_WORKTREE", "ISOLATED_ENVIRONMENT"];
export type IsolationMode = (typeof isolationModes)[number];
export type ArtifactType = 'discovery' | 'specification' | 'architecture-impact' | 'plan' | 'review';
export interface ProjectEntry {
    id: string;
    path: string;
}
export interface ProjectRegistry {
    schemaVersion: 1;
    projects: ProjectEntry[];
}
export interface CommandDefinition {
    executable: string;
    args: string[];
    isolation?: {
        workingDirectory: string;
        image: string;
        timeoutMs: number;
        cpus: number;
        memoryMb: number;
        pids: number;
        network: 'none' | 'proxy';
        allowedDomains: string[];
        requiredForReview: boolean;
        nodeModulesPath?: string;
    };
}
export interface GovernanceRiskRule {
    code: string;
    source: string;
    profile: RiskProfile;
    pathPatterns?: string[];
    commandPatterns?: string[];
    nonDowngradable?: boolean;
}
export interface ProjectGovernance {
    schemaVersion: 2;
    workflowVersion: string;
    projectId: string;
    allowedPaths: string[];
    deniedPaths: string[];
    commands: Record<string, CommandDefinition>;
    dataClassification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
    riskRules: GovernanceRiskRule[];
    confirmations: {
        lightweightSpecification: boolean;
        lightweightPlan: boolean;
    };
    capabilities: {
        allowedMcpServers: string[];
        allowedMcpOperations: string[];
        lightweightNetworkDomains: string[];
    };
    validation: {
        requiredCommands: string[];
        policyCommands: string[];
        requirePolicyValidationForHighRisk: boolean;
        builtInPolicy: true;
    };
}
export interface RiskReason {
    code: string;
    source: string;
    profile: RiskProfile;
    nonDowngradable: boolean;
    detail?: string;
}
export interface RiskAssessmentInput {
    ticketMetadata?: Record<string, string>;
    affectedPaths?: string[];
    requestedCommands?: string[];
    dataClassification?: ProjectGovernance['dataClassification'];
    dependencyChanges?: string[];
    architectureImpact?: boolean;
    implementationIntent?: string;
    networkRequired?: boolean;
    databaseMigration?: boolean;
    authorizationChange?: boolean;
    credentialHandling?: boolean;
}
export interface RiskAssessment {
    minimumProfile: RiskProfile;
    reasons: RiskReason[];
    input: RiskAssessmentInput;
}
export interface ArtifactRecord {
    type: ArtifactType;
    relativePath: string;
    sha256: string;
    updatedAt: string;
}
export interface ConfirmationRecord {
    workItemId: string;
    action: string;
    project: string;
    riskProfile: RiskProfile;
    artifactType?: ArtifactType;
    artifactSha256?: string;
    timestamp: string;
    localOsUser: string;
    reason?: string;
    stale: boolean;
    staleReason?: string;
}
export interface ValidationRecord {
    name: string;
    outcome: 'PASS' | 'FAIL';
    summary: string;
    policyValidation: boolean;
    timestamp: string;
    stale: boolean;
    enforcement: EnforcementEvidence;
    execution: {
        kind: 'COMMAND' | 'FINAL_DIFF';
        outputHash: string;
    };
}
export interface EnforcementEvidence {
    sessionId: string;
    snapshotHash: string;
    governanceHash: string;
    manifestHash: string;
}
export interface ReviewRecord {
    reviewer: string;
    outcome: 'APPROVED' | 'CHANGES_REQUESTED';
    independent: boolean;
    humanReviewed: boolean;
    artifactSha256: string;
    timestamp: string;
    enforcement: EnforcementEvidence;
    reviewSessionId: string;
    findingsHash: string;
    handoffHash?: string;
    confirmationHash: string;
    humanReviewer?: string;
    stale: boolean;
    staleReason?: string;
}
export interface WorkItem {
    schemaVersion: 2;
    gateVersion: 0 | 1;
    id: string;
    project: string;
    ticket: string;
    createdAt: string;
    createdBy: string;
    state: LifecycleState;
    selectedProfile: RiskProfile;
    risk: RiskAssessment;
    artifacts: Partial<Record<ArtifactType, ArtifactRecord>>;
    confirmations: ConfirmationRecord[];
    validations: ValidationRecord[];
    review?: ReviewRecord;
    capabilityManifestHash: string;
    revision: number;
    enforcementEpoch?: number;
    suspension?: {
        active: boolean;
        reason: string;
        timestamp: string;
    };
    enforcementSession?: string;
    reviewSession?: string;
    recoverableCandidateSession?: string;
}
export interface AgentCapabilityManifest {
    workItem: string;
    project: string;
    stage: LifecycleState;
    riskProfile: RiskProfile;
    filesystem: {
        read: string[];
        write: string[];
        delete: string[];
    };
    terminal: {
        available: boolean;
        arbitraryCommands: boolean;
        fixedCommands: string[];
    };
    git: {
        inspect: boolean;
        mutate: boolean;
    };
    mcp: {
        allowedServers: string[];
        allowedOperations: string[];
    };
    network: {
        enabled: boolean;
        allowedDomains: string[];
    };
    credentials: {
        hostCredentialsAvailable: boolean;
    };
    workspace: {
        isolationMode: IsolationMode;
    };
    promotion: {
        required: boolean;
    };
}
export interface EvidenceEventData {
    [key: string]: string | number | boolean | string[] | undefined;
}
export interface EvidenceEvent {
    sequence: number;
    timestamp: string;
    type: string;
    workItem?: string;
    project?: string;
    lifecycleState?: LifecycleState;
    data: EvidenceEventData;
    previousHash: string | null;
    hash: string;
}
export interface ConfirmationInput {
    confirmed: boolean;
    interactive: boolean;
    localOsUser: string;
    reason?: string;
    presentedArtifactSha256?: string;
}
//# sourceMappingURL=types.d.ts.map