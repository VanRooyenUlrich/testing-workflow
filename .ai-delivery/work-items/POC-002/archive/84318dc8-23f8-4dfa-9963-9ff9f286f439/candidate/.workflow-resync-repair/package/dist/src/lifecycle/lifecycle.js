import { invariant } from '../shared/errors.js';
import { lifecycleStates } from '../shared/types.js';
export const transitions = {
    DISCOVERING: 'SPEC_DRAFT', SPEC_DRAFT: 'SPEC_ACCEPTED', SPEC_ACCEPTED: 'PLANNING', PLANNING: 'PLAN_APPROVED',
    PLAN_APPROVED: 'IMPLEMENTING', IMPLEMENTING: 'VALIDATING', VALIDATING: 'READY_FOR_REVIEW', READY_FOR_REVIEW: 'COMPLETE', COMPLETE: null,
};
export function transition(from, to) {
    invariant(transitions[from] === to, `Invalid lifecycle transition: ${from} -> ${to}`, 'TRANSITION_INVALID');
    return to;
}
export function revisionTransition(from) {
    invariant(from === 'VALIDATING', `Invalid revision transition: ${from} -> IMPLEMENTING`, 'REVISION_TRANSITION_INVALID');
    return 'IMPLEMENTING';
}
export function stateAtLeast(state, target) {
    return lifecycleStates.indexOf(state) >= lifecycleStates.indexOf(target);
}
export function requireArtifact(workItem, type) {
    invariant(workItem.artifacts[type], `Required ${type} artefact is missing`, 'ARTEFACT_REQUIRED');
}
//# sourceMappingURL=lifecycle.js.map