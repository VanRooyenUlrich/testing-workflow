import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { capabilityManifestHash } from '../capabilities/capabilities.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { globMatches } from '../shared/glob.js';
import { EvidenceLog } from '../evidence/evidence.js';
import { assertActiveSession, checkDrift } from './session.js';
import { handoffFileName, requireCurrentHandoff } from './bindings.js';
import { changedPaths, classifiedScope, GovernedFiles, listFiles, mandatoryRestricted, normalizePath, snapshot } from './files.js';
import { requirePolicy } from './policy.js';
import { ContainerRunner, runGovernedCommand } from './containers.js';
import { requiredCommandIds } from '../validation/requirements.js';
import { writeTextAtomic } from '../shared/fs.js';
export class PolicyGateway {
    workflow;
    store;
    policy;
    constructor(workflow, store, policy) {
        this.workflow = workflow;
        this.store = store;
        this.policy = policy;
    }
    async current() {
        const state = await this.store.load();
        const item = await this.workflow.status(state.workItem);
        assertActiveSession(this.store, state, item);
        invariant(!item.suspension?.active, 'Workflow suspended', 'WORKFLOW_SUSPENDED');
        const governance = await this.workflow.repository.loadGovernance(item.project);
        invariant(hashObject(governance) === state.governanceHash && hashObject(await this.workflow.repository.loadRegistry()) === state.registryHash, 'Governance or registry changed', 'GOVERNANCE_STALE');
        const manifest = await this.workflow.capabilities(state.workItem);
        invariant(item.capabilityManifestHash === state.manifestHash && capabilityManifestHash(manifest) === state.manifestHash, 'Capability manifest changed; start a fresh session', 'MANIFEST_STALE');
        invariant(hashObject(item.artifacts) === state.artifactsHash, 'Session artifacts changed', 'ARTIFACT_STALE');
        for (const artifact of Object.values(item.artifacts))
            invariant(sha256(await this.workflow.repository.readArtifact(item.id, artifact.type)) === artifact.sha256, 'Artifact hash mismatch', 'ARTIFACT_STALE');
        return state;
    }
    async input(action, options = {}) {
        const state = await this.current();
        const governance = await this.workflow.repository.loadGovernance(state.project);
        let allowed = options.coreAllow ?? true;
        let stageAllow = true;
        let workItemAllow = true;
        let confirmationRequired = options.confirmationRequired ?? false;
        if (options.path !== undefined) {
            const path = normalizePath(options.path);
            allowed = allowed && classifiedScope(governance, path);
            const patterns = action === 'file.read' ? state.manifest.filesystem.read : action === 'file.delete' ? state.manifest.filesystem.delete : state.manifest.filesystem.write;
            stageAllow = patterns.some((pattern) => globMatches(path, pattern));
            if (action !== 'file.read')
                stageAllow = stageAllow && state.role === 'implementation' && state.manifest.stage === 'IMPLEMENTING';
            // Reads need the governed project context. Mutations remain constrained to the
            // exact paths accepted with the work item's risk assessment.
            if (action !== 'file.read') {
                const item = await this.workflow.status(state.workItem);
                const scope = item.risk.input.affectedPaths ?? [];
                workItemAllow = scope.some((pattern) => globMatches(path, pattern));
            }
            if (governance.dataClassification === 'CONFIDENTIAL') {
                const grant = state.grants.find((entry) => entry.path === path && Date.parse(entry.expiresAt) > Date.now() && entry.actor && entry.reason);
                confirmationRequired = !grant;
            }
        }
        if (action === 'command.execute')
            stageAllow = (state.role === 'implementation' || state.role === 'validation') && state.manifest.terminal.available && state.manifest.terminal.fixedCommands.includes(options.command ?? '');
        if (action === 'governance.change')
            allowed = false;
        return { schemaVersion: 1, action, workItem: state.workItem, project: state.project, stage: state.manifest.stage, riskProfile: state.manifest.riskProfile, governanceHash: state.governanceHash, manifestHash: state.manifestHash, fresh: true, suspended: false, coreAllow: allowed, projectAllow: true, workItemAllow, stageAllow, riskAllow: true, confirmationRequired };
    }
    async authorize(action, options = {}) {
        await requirePolicy(this.policy, await this.input(action, options));
    }
    async audit(type, data) {
        const state = await this.store.load();
        await new EvidenceLog(this.workflow.repository.evidencePath()).append({ type, timestamp: new Date().toISOString(), workItem: state.workItem, project: state.project, data: { session: state.id, ...data } });
    }
    async read(path) {
        await this.authorize('file.read', { path });
        const state = await this.current();
        const result = await new GovernedFiles(state.workspace).read(path);
        await this.audit('FILE_READ', { path, sha256: result.sha256 });
        return result;
    }
    async list() {
        await this.authorize('mcp.invoke');
        const state = await this.current();
        const result = [];
        for (const path of await listFiles(state.workspace)) {
            try {
                await this.authorize('file.read', { path });
                result.push(path);
            }
            catch { /* Never leak denied path names. */ }
        }
        return result;
    }
    async search(query) {
        invariant(query.length > 0 && query.length <= 200, 'Bounded literal query required', 'SEARCH_INVALID');
        const result = [];
        for (const path of await this.list()) {
            const file = await this.read(path);
            const lines = file.content.split(/\r?\n/).flatMap((line, index) => line.includes(query) ? [index + 1] : []);
            if (lines.length)
                result.push({ path, lines: lines.slice(0, 100) });
            if (result.length >= 100)
                break;
        }
        return result;
    }
    async mutate(operation, path, expected, content) {
        await this.store.exclusive(async () => {
            const state = await this.current();
            await checkDrift(this.workflow, this.store, state);
            invariant(state.mode !== 'ISOLATED_ENVIRONMENT' || state.runtime === 'CONTAINER', 'Environment writes must be imported from the container export', 'ENVIRONMENT_DIRECT_WRITE_DENIED');
            await this.authorize(operation === 'delete' ? 'file.delete' : 'file.write', { path });
            invariant(changedPaths(state.expectedWorkspace, await snapshot(state.workspace)).length === 0, 'Unexpected isolated workspace change', 'WORKSPACE_DRIFT');
            await this.audit('FILE_OPERATION_INTENT', { operation, path, expectedHash: expected ?? 'ABSENT' });
            await new GovernedFiles(state.workspace).mutate(operation, path, expected, content);
            const next = await snapshot(state.workspace);
            const changed = changedPaths(state.expectedWorkspace, next);
            invariant(changed.every((entry) => entry === path), 'Concurrent unexpected mutation', 'WORKSPACE_DRIFT');
            state.expectedWorkspace = next;
            if (state.mode === 'HOST_WORKSPACE' || state.runtime === 'CONTAINER')
                state.expectedHost = next;
            const invalidatedHandoff = state.handoff?.contentHash;
            delete state.handoff;
            delete state.validation;
            delete state.review;
            await this.store.save(state);
            if (invalidatedHandoff) {
                await unlink(join(this.store.directory, handoffFileName)).catch(() => undefined);
                await this.audit('HANDOFF_INVALIDATED', { contentHash: invalidatedHandoff, reason: 'candidate changed' });
            }
            const item = await this.workflow.status(state.workItem);
            item.validations.forEach((entry) => { entry.stale = true; });
            if (item.review) {
                item.review.stale = true;
                item.review.staleReason = 'candidate changed';
            }
            await this.workflow.repository.saveWorkItem(item);
            await this.audit('FILE_OPERATION_COMMITTED', { operation, path, resultHash: next[path]?.sha256 ?? 'ABSENT' });
        });
    }
    async submitHandoff(content) {
        return this.store.exclusive(async () => {
            const state = await this.current();
            await checkDrift(this.workflow, this.store, state);
            invariant(state.role === 'implementation' && state.lifecycleState === 'IMPLEMENTING', 'Implementation handoff requires an active implementation session', 'SESSION_ROLE_INVALID');
            await this.authorize('workflow.submit');
            const snapshotHash = hashObject(await snapshot(state.workspace));
            const contentHash = sha256(content);
            const submittedAt = new Date().toISOString();
            await writeTextAtomic(join(this.store.directory, handoffFileName), content);
            state.handoff = { contentHash, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash, submittedAt };
            await this.store.save(state);
            await this.audit('HANDOFF_SUBMITTED', { contentHash, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash });
            return { recorded: true, contentHash, snapshotHash };
        });
    }
    async inspectChanges() {
        const state = await this.current();
        await this.authorize('mcp.invoke');
        const current = await snapshot(state.workspace);
        const changes = changedPaths(state.mode === 'HOST_WORKSPACE' ? state.baseline : await this.sourceBaseline(), current);
        const result = [];
        for (const path of changes) {
            await this.authorize('file.read', { path });
            const before = state.sourceBaseline?.[path] ? await readFile(await import('./files.js').then(({ safePath }) => safePath(state.baselineContentRoot, path)), 'utf8') : '';
            const after = current[path] ? await readFile(await import('./files.js').then(({ safePath }) => safePath(state.workspace, path)), 'utf8') : '';
            const beforeLines = before.replace(/\n$/, '').split('\n');
            const afterLines = after.replace(/\n$/, '').split('\n');
            const diff = [`--- ${state.sourceBaseline?.[path] ? `a/${path}` : '/dev/null'}`, `+++ ${current[path] ? `b/${path}` : '/dev/null'}`, `@@ -1,${before ? beforeLines.length : 0} +1,${after ? afterLines.length : 0} @@`, ...beforeLines.filter(() => before.length > 0).map((line) => `-${line}`), ...afterLines.filter(() => after.length > 0).map((line) => `+${line}`)].join('\n');
            result.push({ path, before: state.sourceBaseline?.[path]?.sha256 ?? null, after: current[path]?.sha256 ?? null, diff });
        }
        return result;
    }
    async sourceBaseline() {
        const state = await this.current();
        const governance = await this.workflow.repository.loadGovernance(state.project);
        if (state.sourceBaseline)
            return state.sourceBaseline;
        return Object.fromEntries(Object.entries(state.baseline).filter(([path]) => classifiedScope(governance, path) && governance.dataClassification !== 'CONFIDENTIAL'));
    }
    async validate(runner = new ContainerRunner()) {
        let state = await this.current();
        await checkDrift(this.workflow, this.store, state);
        await requireCurrentHandoff(this.store, state);
        if (state.role === 'implementation') {
            await this.workflow.beginValidation(state.workItem);
            state = await this.current();
        }
        invariant(state.role === 'validation', 'Validation requires an active validation session', 'SESSION_ROLE_INVALID');
        const governance = await this.workflow.repository.loadGovernance(state.project);
        for (const command of requiredCommandIds(governance))
            await runGovernedCommand(this, { id: command }, runner);
        state = await this.current();
        await requireCurrentHandoff(this.store, state);
        await checkDrift(this.workflow, this.store, state);
        await this.authorize('validation.execute');
        const current = await snapshot(state.workspace);
        const changed = changedPaths(await this.sourceBaseline(), current);
        for (const path of changed) {
            invariant(!mandatoryRestricted(path), 'Protected change in candidate', 'PATH_DENIED');
            // Validation uses implementation path policy even during read-only review.
            const item = await this.workflow.status(state.workItem);
            invariant(classifiedScope(governance, path) && (item.risk.input.affectedPaths ?? []).some((pattern) => globMatches(path, pattern)), 'Candidate exceeds approved scope', 'PATH_DENIED');
            if (current[path])
                await readFile(await import('./files.js').then(({ safePath }) => safePath(state.workspace, path)));
        }
        await this.workflow.verifyEvidence();
        const snapshotHash = hashObject(current);
        const sameSnapshot = state.validation?.snapshotHash === snapshotHash;
        const commands = sameSnapshot ? state.validation?.commands ?? [] : [];
        const commandResults = sameSnapshot ? state.validation?.commandResults ?? [] : [];
        const validatedAt = new Date().toISOString();
        const resultHash = hashObject({ sessionId: state.id, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash, changedPaths: changed, commands, commandResults });
        state.validation = { snapshotHash, governanceHash: state.governanceHash, passed: true, commands, changedPaths: changed, commandResults, resultHash, validatedAt };
        await this.store.save(state);
        await this.audit('FINAL_DIFF_VALIDATED', { paths: changed, snapshotHash, resultHash });
        await this.workflow.recordValidation(state.workItem);
        return { passed: true, changedPaths: changed, snapshotHash, resultHash };
    }
}
//# sourceMappingURL=gateway.js.map