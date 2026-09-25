import type { AgentCapabilityManifest, LifecycleState, ProjectGovernance, RiskProfile } from '../shared/types.js';
export declare function calculateCapabilities(input: {
    workItem: string;
    project: string;
    stage: LifecycleState;
    riskProfile: RiskProfile;
    governance: ProjectGovernance;
}): AgentCapabilityManifest;
export declare function capabilityManifestHash(manifest: AgentCapabilityManifest): string;
//# sourceMappingURL=capabilities.d.ts.map