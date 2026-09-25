export interface PruneEntry {
    directory: string;
    sessionId: string;
    workItem: string;
    closedAt: string;
}
export interface PrunePlan {
    root: string;
    olderThan: string;
    entries: PruneEntry[];
    planHash: string;
}
export declare function inspectPrune(root: string, now?: number): Promise<PrunePlan>;
export declare function applyPrune(root: string, planHash: string): Promise<PrunePlan>;
//# sourceMappingURL=prune.d.ts.map