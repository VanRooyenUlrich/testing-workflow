import { type LifecycleState, type WorkItem } from '../shared/types.js';
export declare const transitions: Readonly<Record<LifecycleState, LifecycleState | null>>;
export declare function transition(from: LifecycleState, to: LifecycleState): LifecycleState;
export declare function revisionTransition(from: LifecycleState): LifecycleState;
export declare function stateAtLeast(state: LifecycleState, target: LifecycleState): boolean;
export declare function requireArtifact(workItem: WorkItem, type: keyof WorkItem['artifacts']): void;
//# sourceMappingURL=lifecycle.d.ts.map