import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashObject } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { capabilityManifestHash } from '../capabilities/capabilities.js';
import { SessionStore, checkDrift, requireSession, revokeSession, reviewSessionTtlMs } from './session.js';
import { handoffFileName, requireCurrentHandoff } from './bindings.js';
import { snapshot } from './files.js';
import { EvidenceLog } from '../evidence/evidence.js';
export async function createReviewSession(workflow, sourceStore) {
    const initial = await sourceStore.load();
    const item = await workflow.status(initial.workItem);
    const { state: source } = await requireSession(workflow, item, sourceStore, ['validation']);
    await checkDrift(workflow, sourceStore, source);
    invariant(item.state === 'VALIDATING', 'Independent review requires VALIDATING', 'REVIEW_STAGE_REQUIRED');
    invariant(hashObject(await workflow.repository.loadGovernance(item.project)) === source.governanceHash, 'Stale governance', 'GOVERNANCE_STALE');
    invariant(source.validation?.passed && source.validation.snapshotHash === hashObject(await snapshot(source.workspace)), 'Validated source required', 'VALIDATION_STALE');
    await requireCurrentHandoff(sourceStore, source);
    const directory = await mkdtemp(join(tmpdir(), 'ai-delivery-review-'));
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    await cp(source.workspace, workspace, { recursive: true, dereference: false, errorOnExist: true });
    const manifest = await workflow.capabilities(item.id);
    invariant(capabilityManifestHash(manifest) === item.capabilityManifestHash, 'Stale manifest', 'MANIFEST_STALE');
    if (item.reviewSession)
        await revokeSession(workflow, new SessionStore(item.reviewSession), 'REVIEW_SESSION_REPLACED');
    const currentItem = await workflow.status(item.id);
    const issuedAt = new Date().toISOString();
    const store = new SessionStore(directory);
    const reviewState = { ...source, revision: 0, id: (await import('node:crypto')).randomUUID(), workspace, expectedWorkspace: await snapshot(workspace), manifest, manifestHash: currentItem.capabilityManifestHash, artifactsHash: hashObject(currentItem.artifacts), role: 'review', epoch: currentItem.enforcementEpoch, lifecycleState: currentItem.state, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + reviewSessionTtlMs()).toISOString(), reviewOf: source.id, closed: false };
    delete reviewState.revokedAt;
    delete reviewState.revokedReason;
    delete reviewState.reviewSubmission;
    delete reviewState.review;
    delete reviewState.promotion;
    await cp(join(sourceStore.directory, handoffFileName), join(store.directory, handoffFileName), { force: false });
    await store.save(reviewState);
    currentItem.reviewSession = directory;
    await workflow.repository.saveWorkItem(currentItem);
    await new EvidenceLog(workflow.repository.evidencePath()).append({ type: 'INDEPENDENT_REVIEW_SESSION', timestamp: issuedAt, workItem: item.id, data: { sourceSession: source.id, session: reviewState.id, epoch: reviewState.epoch, expiresAt: reviewState.expiresAt, snapshotHash: source.validation.snapshotHash } });
    return store;
}
//# sourceMappingURL=review.js.map