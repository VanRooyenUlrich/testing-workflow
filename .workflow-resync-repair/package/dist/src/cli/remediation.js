const actions = {
    ENFORCEMENT_SESSION_REQUIRED: 'Run `ai-delivery work next --id ID` and start the reported session role.',
    SESSION_EXPIRED: 'Start an explicit replacement session; the candidate will be preserved and old execution evidence staled.',
    SESSION_REVOKED: 'Use the active session path reported by `ai-delivery work status --id ID`.',
    SESSION_STATE_STALE: 'Run `ai-delivery work next --id ID` and create or resume the session required for the current state.',
    TOOLCHAIN_STALE: 'Run `ai-delivery toolchain prepare --project PROJECT` and then `toolchain verify`.',
    COMMAND_ISOLATION_REQUIRED: 'Run `ai-delivery init` with pinned toolchain images and review the generated governance update.',
    VALIDATION_REQUIRED: 'Run `ai-delivery validation run --session DIRECTORY` for the current candidate.',
    HANDOFF_REQUIRED: 'Resume the implementation provider and submit a candidate-bound handoff before validation.',
    HANDOFF_STALE: 'Resume the implementation provider and submit a fresh handoff for the current candidate.',
    REVIEW_REQUIRED: 'Launch an independent review session, submit its findings, and record the review.',
    PROMOTION_REQUIRED: 'Run `ai-delivery promotion preview`, review the exact diff, then run `promotion apply`.',
    UPGRADE_INTERRUPTED: 'Run `ai-delivery upgrade --dry-run`, then rerun upgrade with `--resume` and accept the same plan hash.',
    PROVIDER_UNAVAILABLE: 'Run `ai-delivery doctor` and follow the provider compatibility remediation.',
    POLICY_UNAVAILABLE: 'Run `ai-delivery policy start`, then `ai-delivery policy status`.',
};
export function suggestedAction(code) { return code ? actions[code] : undefined; }
//# sourceMappingURL=remediation.js.map