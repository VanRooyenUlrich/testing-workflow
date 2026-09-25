import type { SessionRecord, SessionStore } from './session.js';
export declare const handoffFileName = "handoff.md";
export declare function requireCurrentHandoff(store: SessionStore, state: SessionRecord): Promise<{
    content: string;
    metadata: NonNullable<SessionRecord['handoff']>;
}>;
export interface ReviewBinding {
    sourceSession: string;
    snapshotHash: string;
    governanceHash: string;
    manifestHash: string;
    findingsHash: string;
    handoffHash: string;
    outcome: 'APPROVED' | 'CHANGES_REQUESTED';
}
export declare function reviewConfirmationHash(reviewSession: string, binding: ReviewBinding): string;
//# sourceMappingURL=bindings.d.ts.map