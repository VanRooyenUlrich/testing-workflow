export declare const policyActions: readonly ["file.read", "file.write", "file.delete", "command.execute", "network.access", "mcp.invoke", "tool.invoke", "governance.change", "promotion.apply", "workflow.submit", "validation.execute"];
export type PolicyAction = typeof policyActions[number];
export interface PolicyInput {
    schemaVersion: 1;
    action: PolicyAction;
    workItem: string;
    project: string;
    stage: string;
    riskProfile: string;
    governanceHash: string;
    manifestHash: string;
    fresh: boolean;
    suspended: boolean;
    coreAllow: boolean;
    projectAllow: boolean;
    workItemAllow: boolean;
    stageAllow: boolean;
    riskAllow: boolean;
    confirmationRequired: boolean;
}
export interface PolicyDecision {
    decision: 'ALLOW' | 'DENY' | 'ASK';
    reason: string;
}
export interface PolicyEngine {
    decide(input: PolicyInput): Promise<PolicyDecision>;
}
export declare function validPolicyInput(input: PolicyInput): boolean;
export declare function coreAllows(input: PolicyInput): boolean;
/** Only the trusted launcher supplies this endpoint; model input never selects policy or URLs. */
export declare class OpaPolicy implements PolicyEngine {
    private readonly endpoint;
    private readonly transport;
    constructor(endpoint?: string, transport?: typeof fetch);
    decide(input: PolicyInput): Promise<PolicyDecision>;
}
export declare function requirePolicy(engine: PolicyEngine, input: PolicyInput): Promise<void>;
//# sourceMappingURL=policy.d.ts.map