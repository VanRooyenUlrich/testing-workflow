import type { PolicyGateway } from './gateway.js';
import type { PolicyDecision } from './policy.js';
/** Unknown representations fail closed. Native writes/shell cannot bypass optimistic writes or command isolation. */
export declare function preToolUse(gateway: PolicyGateway, raw: unknown): Promise<PolicyDecision>;
/** Revalidate signed state and drift after every provider tool call. */
export declare function postToolUse(gateway: PolicyGateway, raw: unknown): Promise<PolicyDecision>;
export declare function hookOutput(decision: PolicyDecision, event?: 'PreToolUse' | 'PostToolUse'): {
    hookSpecificOutput: {
        hookEventName: "PreToolUse" | "PostToolUse";
        permissionDecision: string;
        permissionDecisionReason: string;
    };
};
//# sourceMappingURL=hooks.d.ts.map