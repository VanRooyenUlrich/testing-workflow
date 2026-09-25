import type { ArtifactRecord, ArtifactType, ConfirmationInput, ConfirmationRecord, RiskProfile } from '../shared/types.js';
export declare function createConfirmation(input: ConfirmationInput, context: {
    workItemId: string;
    action: string;
    project: string;
    riskProfile: RiskProfile;
    timestamp: string;
    artifact?: ArtifactRecord;
    reasonRequired?: boolean;
}): ConfirmationRecord;
export declare function validApproval(confirmations: ConfirmationRecord[], action: string, artifact?: ArtifactRecord): ConfirmationRecord | undefined;
export declare function invalidateApprovals(confirmations: ConfirmationRecord[], actions: string[], reason: string): number;
export declare function approvalAction(type: ArtifactType): string;
//# sourceMappingURL=approvals.d.ts.map