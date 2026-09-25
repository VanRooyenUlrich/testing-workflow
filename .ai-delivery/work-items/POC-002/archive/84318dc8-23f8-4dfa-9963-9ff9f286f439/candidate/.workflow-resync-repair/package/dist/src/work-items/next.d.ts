import type { WorkItem } from '../shared/types.js';
export interface NextAction {
    state: WorkItem['state'];
    missing: string[];
    command: string | null;
}
export declare function nextAction(item: WorkItem): Promise<NextAction>;
//# sourceMappingURL=next.d.ts.map