import { type SessionTransaction } from './session.js';
import type { PromotionJournal } from './promotion.js';
export type RecoveryEntry = {
    kind: 'PROMOTION';
    workItem: string;
    transactionId: string;
    state: PromotionJournal['state'];
    session: string;
    action: 'RESUME' | 'FINALIZE_ROLLBACK';
} | {
    kind: 'SESSION_BINDING';
    workItem: string;
    transactionId: string;
    state: SessionTransaction['state'];
    session: string;
    action: 'RESUME' | 'FINALIZE';
};
export interface RecoveryPlan {
    root: string;
    entries: RecoveryEntry[];
    planHash: string;
}
export declare function inspectRecovery(root: string): Promise<RecoveryPlan>;
export declare function applyRecovery(root: string, acceptedPlanHash: string): Promise<RecoveryPlan>;
//# sourceMappingURL=recovery.d.ts.map