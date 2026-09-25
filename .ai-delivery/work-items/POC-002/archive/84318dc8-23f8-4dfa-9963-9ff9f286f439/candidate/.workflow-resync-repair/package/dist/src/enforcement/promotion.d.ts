import type { ConfirmationInput } from '../shared/types.js';
import type { PolicyGateway } from './gateway.js';
export interface PromotionSummary {
    workItem: string;
    project: string;
    riskProfile: string;
    targetRepository: string;
    baselineCommit: string;
    changes: {
        path: string;
        before: string | null;
        after: string | null;
        additions: number;
        deletions: number;
    }[];
    validation: 'PASS';
    review: 'APPROVED' | 'REQUIRED';
    policy: 'ALLOW';
    snapshotHash: string;
    confirmationHash: string;
}
export interface PromotionJournal {
    schemaVersion: 1;
    transactionId: string;
    workItem: string;
    sessionId: string;
    confirmationHash: string;
    snapshotHash: string;
    state: 'INTENT' | 'APPLYING' | 'APPLIED' | 'ROLLING_BACK' | 'ROLLED_BACK';
    changes: {
        path: string;
        before: string | null;
        after: string | null;
        applied: boolean;
        createdDirectories: string[];
    }[];
    createdAt: string;
    updatedAt: string;
}
export declare class PatchPromotion {
    private readonly gateway;
    constructor(gateway: PolicyGateway);
    private inspect;
    preview(): Promise<PromotionSummary>;
    apply(confirmation: ConfirmationInput): Promise<PromotionSummary>;
}
//# sourceMappingURL=promotion.d.ts.map