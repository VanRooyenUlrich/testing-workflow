import { cp, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { GitInspector } from '../git/git-inspector.js';
import { capabilityManifestHash } from '../capabilities/capabilities.js';
import { findProject, createProjectRegistry } from '../projects/projects.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { readJson, withFileLock, writeJsonAtomic } from '../shared/fs.js';
import { EvidenceLog } from '../evidence/evidence.js';
import { parseSessionRecord, parseSessionTransaction } from '../schemas/validation.js';
import { changedPaths, classifiedScope, listFiles, safePath, snapshot, within } from './files.js';
import { handoffFileName } from './bindings.js';
export function sessionTransactionPath(root, workItem) { return join(root, '.ai-delivery', 'transactions', `session-${workItem}.json`); }
export class SessionStore {
    directory;
    constructor(directory) {
        this.directory = directory;
    }
    async read() {
        const state = parseSessionRecord(await readJson(join(this.directory, 'session.json')));
        const issued = Date.parse(state.issuedAt);
        const expires = Date.parse(state.expiresAt);
        const maximumLifetime = state.role === 'review' ? 2 * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
        invariant(state.schemaVersion === 1 && typeof state.id === 'string' && ['discovery', 'specification', 'planning', 'implementation', 'validation', 'review'].includes(state.role) && Number.isInteger(state.epoch) && state.epoch > 0 && Number.isFinite(issued) && Number.isFinite(expires) && expires > issued && expires - issued <= maximumLifetime && state.manifestHash === capabilityManifestHash(state.manifest), 'Invalid session record', 'SESSION_INVALID');
        return state;
    }
    async load() {
        const state = await this.read();
        invariant(!state.closed && !state.revokedAt, 'Session is closed or revoked', 'SESSION_REVOKED');
        invariant(Number.isFinite(Date.parse(state.expiresAt)) && Date.parse(state.expiresAt) > Date.now(), 'Session has expired', 'SESSION_EXPIRED');
        return state;
    }
    async save(state) {
        const path = join(this.directory, 'session.json');
        const expectedRevision = state.revision;
        await withFileLock(`${path}.lock`, async () => {
            let current;
            try {
                current = parseSessionRecord(await readJson(path));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (current)
                invariant(current.revision === expectedRevision, `Session changed from revision ${expectedRevision} to ${current.revision}`, 'SESSION_REVISION_CONFLICT');
            else
                invariant(expectedRevision === 0, 'New session must start at revision 0', 'SESSION_REVISION_CONFLICT');
            const next = parseSessionRecord({ ...state, revision: expectedRevision + 1 });
            await writeJsonAtomic(path, next);
            state.revision = next.revision;
        });
    }
    async exclusive(operation) {
        return withFileLock(join(this.directory, 'operation.lock'), operation);
    }
}
function approvalContext(item) {
    return hashObject([item.artifacts.specification ?? null, item.artifacts.plan ?? null, item.artifacts['architecture-impact'] ?? null]);
}
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REVIEW_TTL_MS = 2 * 60 * 60 * 1000;
function activePointer(item, role) { return role === 'review' ? item.reviewSession : item.enforcementSession; }
function roleMatchesState(role, state) {
    if (role === 'discovery')
        return state === 'DISCOVERING';
    if (role === 'specification')
        return state === 'SPEC_DRAFT';
    if (role === 'planning')
        return state === 'SPEC_ACCEPTED' || state === 'PLANNING';
    return role === 'implementation' ? ['PLAN_APPROVED', 'IMPLEMENTING'].includes(state) : role === 'validation' ? ['VALIDATING', 'READY_FOR_REVIEW'].includes(state) : state === 'VALIDATING';
}
function roleForState(state) {
    if (state === 'DISCOVERING')
        return 'discovery';
    if (state === 'SPEC_DRAFT')
        return 'specification';
    if (state === 'SPEC_ACCEPTED' || state === 'PLANNING')
        return 'planning';
    if (state === 'PLAN_APPROVED' || state === 'IMPLEMENTING')
        return 'implementation';
    if (state === 'VALIDATING' || state === 'READY_FOR_REVIEW')
        return 'validation';
    invariant(false, 'Completed work items cannot start sessions', 'SESSION_STAGE_INVALID');
}
export function assertActiveSession(store, state, item) {
    invariant(state.epoch === (item.enforcementEpoch ?? 0), 'Session epoch has been superseded', 'SESSION_REVOKED');
    invariant(activePointer(item, state.role) !== undefined && resolve(activePointer(item, state.role)) === resolve(store.directory), 'Session is not the active session for this role and epoch', 'SESSION_REVOKED');
    invariant(state.lifecycleState === item.state && roleMatchesState(state.role, item.state), 'Session was invalidated by a lifecycle state change', 'SESSION_STATE_STALE');
}
export async function requireSession(workflow, item, store, roles) {
    const state = await store.load();
    assertActiveSession(store, state, item);
    invariant(state.workItem === item.id && state.project === item.project && resolve(state.repository) === resolve(workflow.repository.gitRoot), 'Session is not bound to this work item and repository', 'SESSION_BINDING_INVALID');
    invariant(roles.includes(state.role), 'Session role is not authorized for this lifecycle action', 'SESSION_ROLE_INVALID');
    const registry = await workflow.repository.loadRegistry();
    createProjectRegistry(workflow.repository.gitRoot, registry.projects);
    const project = findProject(registry, item.project);
    const governance = await workflow.repository.loadGovernance(item.project);
    invariant(resolve(state.hostRoot) === resolve(workflow.repository.gitRoot, project.path), 'Session project root changed', 'SESSION_BINDING_INVALID');
    invariant(state.registryHash === hashObject(registry) && state.governanceHash === hashObject(governance), 'Session governance or registry is stale', 'GOVERNANCE_STALE');
    const manifest = await workflow.capabilities(item.id);
    invariant(state.manifestHash === item.capabilityManifestHash && state.manifestHash === capabilityManifestHash(manifest), 'Session capability manifest is stale', 'MANIFEST_STALE');
    invariant(state.artifactsHash === hashObject(item.artifacts) && state.approvalContextHash === approvalContext(item), 'Session artifacts or approvals are stale', 'ARTIFACT_STALE');
    for (const artifact of Object.values(item.artifacts))
        invariant(sha256(await workflow.repository.readArtifact(item.id, artifact.type)) === artifact.sha256, 'Artifact content changed', 'ARTIFACT_STALE');
    await checkDrift(workflow, store, state);
    const current = await snapshot(state.workspace);
    invariant(changedPaths(state.expectedWorkspace, current).length === 0, 'Session workspace changed outside governed operations', 'WORKSPACE_DRIFT');
    await workflow.verifyEvidence();
    return { store, state, evidence: { sessionId: state.id, snapshotHash: hashObject(current), governanceHash: state.governanceHash, manifestHash: state.manifestHash } };
}
export async function requireCurrentSession(workflow, item, roles = ['implementation', 'validation']) {
    invariant(item.enforcementSession, 'A current governed enforcement session is required', 'ENFORCEMENT_SESSION_REQUIRED');
    const store = new SessionStore(resolve(item.enforcementSession));
    return requireSession(workflow, item, store, roles);
}
export async function refreshCurrentSession(workflow, item, store, role) {
    const state = await store.load();
    invariant(state.workItem === item.id && state.project === item.project && resolve(state.repository) === resolve(workflow.repository.gitRoot), 'Session is not bound to this work item and repository', 'SESSION_BINDING_INVALID');
    invariant(state.epoch === (item.enforcementEpoch ?? 0) && resolve(item.enforcementSession ?? '') === resolve(store.directory), 'Cannot refresh a superseded session', 'SESSION_REVOKED');
    state.manifest = await workflow.capabilities(item.id);
    state.manifestHash = item.capabilityManifestHash;
    state.artifactsHash = hashObject(item.artifacts);
    state.approvalContextHash = approvalContext(item);
    if (state.handoff)
        state.handoff.manifestHash = state.manifestHash;
    if (role)
        state.role = role;
    state.lifecycleState = item.state;
    await store.save(state);
    return state;
}
async function revokeRecord(workflow, store, reason) {
    let state;
    try {
        state = await store.read();
    }
    catch {
        return;
    }
    if (state.revokedAt || state.closed)
        return;
    state.revokedAt = new Date().toISOString();
    state.revokedReason = reason;
    state.closed = true;
    delete state.validation;
    delete state.review;
    delete state.reviewSubmission;
    await store.save(state);
    await new EvidenceLog(workflow.repository.evidencePath()).append({ type: 'SESSION_REVOKED', timestamp: state.revokedAt, workItem: state.workItem, project: state.project, data: { session: state.id, epoch: state.epoch, role: state.role, reason } });
}
export async function revokeSession(workflow, store, reason) {
    const state = await store.read();
    await revokeRecord(workflow, store, reason);
    const item = await workflow.status(state.workItem);
    if (state.role === 'review' && item.reviewSession && resolve(item.reviewSession) === resolve(store.directory))
        delete item.reviewSession;
    if (state.role !== 'review' && item.enforcementSession && resolve(item.enforcementSession) === resolve(store.directory))
        delete item.enforcementSession;
    await workflow.repository.saveWorkItem(item);
}
export async function createSession(workflow, workItem, options = {}) {
    const item = await workflow.status(workItem);
    const manifest = await workflow.capabilities(workItem);
    invariant(!item.suspension?.active, 'Workflow suspended', 'WORKFLOW_SUSPENDED');
    invariant(item.capabilityManifestHash === capabilityManifestHash(manifest), 'Stale capability manifest', 'MANIFEST_STALE');
    const role = roleForState(item.state);
    const registry = await workflow.repository.loadRegistry();
    createProjectRegistry(workflow.repository.gitRoot, registry.projects);
    const project = findProject(registry, item.project);
    const hostRoot = resolve(workflow.repository.gitRoot, project.path);
    const governance = await workflow.repository.loadGovernance(item.project);
    let seedStore = options.seedStore;
    if (!seedStore && item.enforcementSession && item.state !== 'PLAN_APPROVED')
        seedStore = new SessionStore(resolve(item.enforcementSession));
    if (!seedStore && item.recoverableCandidateSession)
        seedStore = new SessionStore(resolve(item.recoverableCandidateSession));
    let seed;
    if (seedStore) {
        seed = await seedStore.read();
        invariant(seed.workItem === item.id && seed.project === item.project && seed.epoch === (item.enforcementEpoch ?? 0), 'Replacement seed is not the current work-item epoch', 'SESSION_REVOKED');
        invariant(changedPaths(seed.expectedHost, await snapshot(seed.hostRoot)).length === 0 && changedPaths(seed.expectedWorkspace, await snapshot(seed.workspace)).length === 0, 'Replacement seed has drifted', 'WORKSPACE_DRIFT');
    }
    const mode = options.mode ?? seed?.mode ?? manifest.workspace.isolationMode;
    invariant(item.selectedProfile !== 'HIGH_RISK' || mode === 'ISOLATED_ENVIRONMENT', 'HIGH_RISK requires isolated environment', 'ISOLATION_REQUIRED');
    invariant(item.selectedProfile === 'LIGHTWEIGHT' || mode !== 'HOST_WORKSPACE', 'Host mode requires LIGHTWEIGHT', 'ISOLATION_REQUIRED');
    const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'ai-delivery-session-'));
    invariant(!within(workflow.repository.gitRoot, directory) && (!item.enforcementSession || resolve(directory) !== resolve(item.enforcementSession)), 'Session control plane must be a fresh directory outside the consuming repository', 'CONTROL_PLANE_LOCATION');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
        await readJson(join(directory, 'session.json'));
        invariant(false, 'Session directory is already initialized', 'SESSION_DIRECTORY_IN_USE');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    const hostSnapshot = await snapshot(hostRoot);
    const baseline = seed?.baseline ?? hostSnapshot;
    const expectedHost = seed?.expectedHost ?? hostSnapshot;
    invariant(changedPaths(expectedHost, hostSnapshot).length === 0, 'Host drift during session creation', 'HOST_DRIFT');
    const workspace = mode === 'HOST_WORKSPACE' ? hostRoot : join(directory, 'workspace');
    const sourceRoot = seed?.workspace ?? hostRoot;
    const sourceSnapshot = await snapshot(sourceRoot);
    if (mode !== 'HOST_WORKSPACE') {
        await mkdir(workspace, { mode: 0o700 });
        for (const path of Object.keys(sourceSnapshot)) {
            if (!classifiedScope(governance, path) || governance.dataClassification === 'CONFIDENTIAL')
                continue;
            const source = await safePath(sourceRoot, path);
            const data = await readFile(source);
            invariant(sha256(data) === sourceSnapshot[path].sha256, 'Source changed while snapshotting', 'WORKSPACE_DRIFT');
            const destination = join(workspace, path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, data, { flag: 'wx' });
        }
    }
    const workspaceSnapshot = await snapshot(workspace);
    const sourceBaseline = seed?.sourceBaseline ?? Object.fromEntries(Object.entries(workspaceSnapshot).filter(([path]) => classifiedScope(governance, path) && governance.dataClassification !== 'CONFIDENTIAL'));
    const baselineContentRoot = join(directory, 'baseline-content');
    await mkdir(baselineContentRoot, { mode: 0o700 });
    const baselineSource = seed?.baselineContentRoot ?? hostRoot;
    for (const path of Object.keys(sourceBaseline)) {
        const source = await safePath(baselineSource, path);
        const data = await readFile(source);
        invariant(sha256(data) === sourceBaseline[path].sha256, 'Baseline content changed during session preparation', 'WORKSPACE_DRIFT');
        const destination = join(baselineContentRoot, path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, data, { flag: 'wx', mode: 0o400 });
    }
    const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
    invariant(Number.isInteger(ttlMs) && ttlMs >= 60000 && ttlMs <= SESSION_TTL_MS, 'Session expiry must be between one minute and eight hours', 'SESSION_EXPIRY_INVALID');
    const issuedAt = new Date().toISOString();
    const epoch = (item.enforcementEpoch ?? 0) + 1;
    const state = { schemaVersion: 1, revision: 0, id: randomUUID(), workItem, project: item.project, repository: workflow.repository.gitRoot, hostRoot, workspace, baselineContentRoot, mode, governanceHash: hashObject(governance), registryHash: hashObject(registry), manifestHash: capabilityManifestHash(manifest), manifest, baseline, sourceBaseline, expectedHost, expectedWorkspace: await snapshot(workspace), artifactsHash: hashObject(item.artifacts), approvalContextHash: approvalContext(item), ...(seed?.baselineCommit === undefined ? {} : { baselineCommit: seed.baselineCommit }), role, epoch, lifecycleState: item.state, issuedAt, expiresAt: new Date(Date.parse(issuedAt) + ttlMs).toISOString(), grants: [], closed: false };
    if (!state.baselineCommit)
        try {
            state.baselineCommit = await new GitInspector(workflow.repository.gitRoot).baselineCommit();
        }
        catch { /* Non-Git snapshots are usable, but cannot be promoted. */ }
    const store = new SessionStore(directory);
    const transaction = { schemaVersion: 1, transactionId: randomUUID(), workItem, project: item.project, expectedRevision: item.revision, expectedEpoch: item.enforcementEpoch ?? 0, newSession: { directory, id: state.id, epoch }, ...(item.enforcementSession ? { previousSession: item.enforcementSession } : {}), ...(item.reviewSession ? { previousReviewSession: item.reviewSession } : {}), state: 'INTENT', createdAt: issuedAt };
    await workflow.repository.exclusiveCommit(async () => {
        const currentItem = await workflow.status(workItem);
        invariant(currentItem.revision === item.revision && currentItem.state === item.state && (currentItem.enforcementEpoch ?? 0) === (item.enforcementEpoch ?? 0), 'Work item changed during session preparation', 'WORK_ITEM_REVISION_CONFLICT');
        const transactionPath = sessionTransactionPath(workflow.repository.gitRoot, workItem);
        try {
            await readFile(transactionPath);
            invariant(false, 'Unrecovered session transaction exists; run recover', 'RECOVERY_REQUIRED');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        await writeJsonAtomic(transactionPath, parseSessionTransaction(transaction));
        await store.save(state);
        transaction.state = 'SESSION_WRITTEN';
        await writeJsonAtomic(transactionPath, parseSessionTransaction(transaction));
        if (currentItem.enforcementSession)
            await revokeRecord(workflow, new SessionStore(resolve(currentItem.enforcementSession)), 'SESSION_REPLACED');
        if (currentItem.reviewSession)
            await revokeRecord(workflow, new SessionStore(resolve(currentItem.reviewSession)), 'SESSION_EPOCH_REPLACED');
        currentItem.validations.forEach((entry) => { entry.stale = true; });
        if (currentItem.review) {
            currentItem.review.stale = true;
            currentItem.review.staleReason = 'session epoch replaced';
        }
        currentItem.enforcementEpoch = epoch;
        currentItem.enforcementSession = directory;
        delete currentItem.reviewSession;
        delete currentItem.recoverableCandidateSession;
        await workflow.repository.saveWorkItem(currentItem);
        transaction.state = 'BOUND';
        await writeJsonAtomic(transactionPath, parseSessionTransaction(transaction));
    });
    await new EvidenceLog(workflow.repository.evidencePath()).append({ type: 'SESSION_PREPARED', timestamp: issuedAt, workItem, project: item.project, data: { session: state.id, epoch, role, isolation: mode, manifestHash: state.manifestHash, expiresAt: state.expiresAt, transaction: transaction.transactionId } });
    await unlink(sessionTransactionPath(workflow.repository.gitRoot, workItem));
    return store;
}
export function reviewSessionTtlMs() { return REVIEW_TTL_MS; }
export async function archiveSession(workflow, store) {
    const state = await store.read();
    const target = join(workflow.repository.workItemDirectory(state.workItem), 'archive', state.id);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await cp(join(store.directory, 'session.json'), join(target, 'session.json'), { force: false });
    for (const name of ['logs', 'baseline-content'])
        try {
            await cp(join(store.directory, name), join(target, name), { recursive: true, force: false });
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    for (const name of await readdir(store.directory))
        if (/^isolated-evidence-[A-Za-z0-9-]+\.jsonl$/.test(name))
            await cp(join(store.directory, name), join(target, name), { force: false });
    const governance = await workflow.repository.loadGovernance(state.project);
    const candidate = join(target, 'candidate');
    await mkdir(candidate, { mode: 0o700 });
    for (const path of await listFiles(state.workspace))
        if (classifiedScope(governance, path) && governance.dataClassification !== 'CONFIDENTIAL') {
            const destination = join(candidate, path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, await readFile(await safePath(state.workspace, path)), { flag: 'wx', mode: 0o400 });
        }
    for (const name of [handoffFileName, 'review.md'])
        try {
            await cp(join(store.directory, name), join(target, name), { force: false });
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    return target;
}
export async function checkDrift(workflow, store, state) {
    let drift = false;
    try {
        drift = changedPaths(state.expectedHost, await snapshot(state.hostRoot)).length > 0;
    }
    catch {
        drift = true;
    }
    if (drift) {
        const item = await workflow.status(state.workItem);
        item.suspension = { active: true, reason: 'HOST_DRIFT', timestamp: new Date().toISOString() };
        await workflow.repository.saveWorkItem(item);
        await new EvidenceLog(workflow.repository.evidencePath()).append({ type: 'WORKFLOW_SUSPENDED', timestamp: new Date().toISOString(), workItem: state.workItem, data: { reason: 'HOST_DRIFT', session: state.id } });
        await store.save(state);
    }
    invariant(!drift && !(await workflow.status(state.workItem)).suspension?.active, 'Unexpected host mutation; human resynchronization required', 'WORKFLOW_SUSPENDED');
}
export async function resynchronize(workflow, store, confirmation) {
    invariant(confirmation.confirmed && confirmation.interactive && confirmation.localOsUser && confirmation.reason?.trim(), 'Human confirmation and investigation reason required', 'CONFIRMATION_REQUIRED');
    await store.exclusive(async () => {
        const state = await store.read();
        const item = await workflow.status(state.workItem);
        state.closed = true;
        state.revokedAt = new Date().toISOString();
        state.revokedReason = 'HUMAN_RESYNCHRONIZED';
        delete state.validation;
        delete state.review;
        delete state.reviewSubmission;
        // Close, never bless a new baseline into an old approved patch.
        await store.save(state);
        item.suspension = { active: false, reason: confirmation.reason, timestamp: new Date().toISOString() };
        item.validations.forEach((entry) => { entry.stale = true; });
        if (item.review) {
            item.review.stale = true;
            item.review.staleReason = 'human resynchronization';
        }
        if (item.reviewSession)
            await revokeRecord(workflow, new SessionStore(resolve(item.reviewSession)), 'HUMAN_RESYNCHRONIZED');
        item.enforcementEpoch = (item.enforcementEpoch ?? state.epoch) + 1;
        delete item.enforcementSession;
        delete item.reviewSession;
        await workflow.repository.saveWorkItem(item);
        await new EvidenceLog(workflow.repository.evidencePath()).append({ type: 'HUMAN_RESYNCHRONIZED', timestamp: new Date().toISOString(), workItem: item.id, data: { actor: confirmation.localOsUser, reason: confirmation.reason, sessionClosed: state.id } });
    });
}
//# sourceMappingURL=session.js.map