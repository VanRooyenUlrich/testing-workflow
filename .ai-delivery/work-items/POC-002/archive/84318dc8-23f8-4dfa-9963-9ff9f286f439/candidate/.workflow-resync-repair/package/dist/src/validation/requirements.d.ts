import type { ProjectGovernance } from '../shared/types.js';
/** The single gate definition used by validation, review, delivery, and completion. */
export declare function requiredCommandIds(governance: ProjectGovernance): string[];
export declare function missingRequiredCommands(governance: ProjectGovernance, passed: Iterable<string>): string[];
//# sourceMappingURL=requirements.d.ts.map