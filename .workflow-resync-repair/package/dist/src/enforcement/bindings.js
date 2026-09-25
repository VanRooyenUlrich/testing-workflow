import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { snapshot } from './files.js';
export const handoffFileName = 'handoff.md';
export async function requireCurrentHandoff(store, state) {
    invariant(state.handoff, 'A candidate-bound implementation handoff is required before validation', 'HANDOFF_REQUIRED');
    let content;
    try {
        content = await readFile(join(store.directory, handoffFileName), 'utf8');
    }
    catch {
        invariant(false, 'The candidate-bound implementation handoff file is missing', 'HANDOFF_STALE');
    }
    const snapshotHash = hashObject(await snapshot(state.workspace));
    invariant(sha256(content) === state.handoff.contentHash
        && state.handoff.snapshotHash === snapshotHash
        && state.handoff.governanceHash === state.governanceHash
        && state.handoff.manifestHash === state.manifestHash, 'The candidate-bound implementation handoff is stale', 'HANDOFF_STALE');
    return { content: content, metadata: state.handoff };
}
export function reviewConfirmationHash(reviewSession, binding) {
    return hashObject({
        sourceSession: binding.sourceSession,
        reviewSession,
        snapshotHash: binding.snapshotHash,
        governanceHash: binding.governanceHash,
        manifestHash: binding.manifestHash,
        findingsHash: binding.findingsHash,
        handoffHash: binding.handoffHash,
        outcome: binding.outcome,
    });
}
//# sourceMappingURL=bindings.js.map