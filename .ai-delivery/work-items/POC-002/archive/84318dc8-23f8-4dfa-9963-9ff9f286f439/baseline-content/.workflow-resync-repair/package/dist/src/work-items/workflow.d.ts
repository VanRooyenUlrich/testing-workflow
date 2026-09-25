import type { ConfirmationInput, RiskAssessmentInput, RiskProfile, WorkItem } from '../shared/types.js';
import type { WorkflowRepository } from './repository.js';
export interface WorkflowDependencies {
    now?: () => string;
    actor?: () => string;
}
export declare class Workflow {
    readonly repository: WorkflowRepository;
    private readonly evidence;
    private readonly now;
    private readonly actor;
    constructor(repository: WorkflowRepository, dependencies?: WorkflowDependencies);
    private governance;
    private persist;
    private record;
    private move;
    create(input: {
        id: string;
        project: string;
        ticket?: string;
        profile?: RiskProfile;
        risk?: RiskAssessmentInput;
    }): Promise<WorkItem>;
    status(id: string): Promise<WorkItem>;
    capabilities(id: string): Promise<import("../shared/types.js").AgentCapabilityManifest>;
    private submitArtifact;
    submitDiscovery(id: string, content: string): Promise<WorkItem>;
    submitSpecification(id: string, content: string): Promise<WorkItem>;
    private confirmationRequired;
    acceptSpecification(id: string, confirmation?: ConfirmationInput): Promise<WorkItem>;
    submitArchitecture(id: string, content: string): Promise<WorkItem>;
    approveArchitecture(id: string, confirmation: ConfirmationInput): Promise<WorkItem>;
    private requireCurrentApproval;
    submitPlan(id: string, content: string): Promise<WorkItem>;
    approvePlan(id: string, confirmation?: ConfirmationInput): Promise<WorkItem>;
    beginImplementation(id: string): Promise<WorkItem>;
    beginValidation(id: string): Promise<WorkItem>;
    reviseImplementation(id: string, reason: string): Promise<WorkItem>;
    recordValidation(id: string): Promise<WorkItem>;
    recordReview(id: string, reviewSessionDirectory: string, confirmation?: ConfirmationInput): Promise<WorkItem>;
    complete(id: string, confirmation: ConfirmationInput): Promise<WorkItem>;
    assessRisk(id: string, newInput: RiskAssessmentInput): Promise<WorkItem>;
    overrideRisk(id: string, requested: RiskProfile, confirmation?: ConfirmationInput): Promise<WorkItem>;
    verifyEvidence(): Promise<{
        valid: true;
        events: number;
        headHash: string | null;
    }>;
}
//# sourceMappingURL=workflow.d.ts.map