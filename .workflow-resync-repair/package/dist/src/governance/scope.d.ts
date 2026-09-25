import type { ProjectGovernance } from '../shared/types.js';
export declare function checkGovernedPath(governance: ProjectGovernance, path: string): {
    allowed: boolean;
    reason: string;
};
export declare function requireGovernedPath(governance: ProjectGovernance, path: string): void;
//# sourceMappingURL=scope.d.ts.map