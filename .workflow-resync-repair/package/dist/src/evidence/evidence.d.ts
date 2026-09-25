import type { EvidenceEvent, EvidenceEventData, LifecycleState } from '../shared/types.js';
export interface EvidenceInput {
    type: string;
    timestamp: string;
    workItem?: string;
    project?: string;
    lifecycleState?: LifecycleState;
    data?: EvidenceEventData;
}
export declare class EvidenceLog {
    private readonly path;
    constructor(path: string);
    private readUnlocked;
    read(): Promise<EvidenceEvent[]>;
    append(input: EvidenceInput): Promise<EvidenceEvent>;
    private verifyEvents;
    verify(): Promise<{
        valid: true;
        events: number;
        headHash: string | null;
    }>;
}
//# sourceMappingURL=evidence.d.ts.map