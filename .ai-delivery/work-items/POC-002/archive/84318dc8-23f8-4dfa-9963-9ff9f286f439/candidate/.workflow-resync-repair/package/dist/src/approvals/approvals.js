import { invariant } from '../shared/errors.js';
import { parseConfirmation } from '../schemas/validation.js';
export function createConfirmation(input, context) {
    invariant(input.confirmed, 'Explicit confirmation was not given', 'CONFIRMATION_REQUIRED');
    invariant(input.interactive, 'Human-confirmed action requires an interactive TTY', 'CONFIRMATION_NOT_INTERACTIVE');
    invariant(input.localOsUser.trim().length > 0, 'Local OS user is required', 'CONFIRMATION_USER_REQUIRED');
    if (context.reasonRequired)
        invariant((input.reason ?? '').trim().length > 0, 'A reason is required', 'CONFIRMATION_REASON_REQUIRED');
    if (input.presentedArtifactSha256 !== undefined && context.artifact !== undefined) {
        invariant(input.presentedArtifactSha256 === context.artifact.sha256, `Confirmation hash does not match current ${context.artifact.type}`, 'APPROVAL_HASH_INCORRECT');
    }
    return parseConfirmation({
        workItemId: context.workItemId, action: context.action, project: context.project, riskProfile: context.riskProfile,
        ...(context.artifact === undefined ? {} : { artifactType: context.artifact.type, artifactSha256: context.artifact.sha256 }),
        timestamp: context.timestamp, localOsUser: input.localOsUser,
        ...(input.reason === undefined ? {} : { reason: input.reason }), stale: false,
    });
}
export function validApproval(confirmations, action, artifact) {
    return confirmations.findLast((confirmation) => confirmation.action === action && !confirmation.stale && (artifact === undefined || (confirmation.artifactType === artifact.type && confirmation.artifactSha256 === artifact.sha256)));
}
export function invalidateApprovals(confirmations, actions, reason) {
    let count = 0;
    for (const confirmation of confirmations) {
        if (!confirmation.stale && actions.includes(confirmation.action)) {
            confirmation.stale = true;
            confirmation.staleReason = reason;
            count += 1;
        }
    }
    return count;
}
export function approvalAction(type) {
    if (type === 'specification')
        return 'ACCEPT_SPECIFICATION';
    if (type === 'plan')
        return 'APPROVE_PLAN';
    if (type === 'architecture-impact')
        return 'APPROVE_ARCHITECTURE';
    return `APPROVE_${type.toUpperCase()}`;
}
//# sourceMappingURL=approvals.js.map