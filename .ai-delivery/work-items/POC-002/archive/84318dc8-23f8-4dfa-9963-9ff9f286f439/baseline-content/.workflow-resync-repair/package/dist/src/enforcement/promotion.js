import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashObject, sha256 } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { validApproval } from '../approvals/approvals.js';
import { capabilityManifestHash } from '../capabilities/capabilities.js';
import { GitInspector } from '../git/git-inspector.js';
import { classifyRisk, isHigherProfile } from '../risk/risk.js';
import { globMatches } from '../shared/glob.js';
import { changedPaths, classifiedScope, GovernedFiles, removeCreatedDirectories, safePath, snapshot } from './files.js';
import { checkDrift } from './session.js';
import { requirePolicy } from './policy.js';
import { requiredCommandIds } from '../validation/requirements.js';
import { writeJsonAtomic } from '../shared/fs.js';
import { parseDeliveryReceipt } from '../schemas/validation.js';
function human(confirmation, hash) {
    invariant(confirmation.confirmed && confirmation.interactive && confirmation.localOsUser.trim() && confirmation.presentedArtifactSha256 === hash, 'Interactive confirmation of this exact candidate required', 'CONFIRMATION_REQUIRED');
}
export class PatchPromotion {
    gateway;
    constructor(gateway) {
        this.gateway = gateway;
    }
    async inspect(requireReview) {
        const state = await this.gateway.store.load();
        const workflow = this.gateway.workflow;
        const item = await workflow.status(state.workItem);
        invariant(state.mode !== 'HOST_WORKSPACE', 'Host sessions have no promotion target', 'PROMOTION_NOT_REQUIRED');
        invariant(!state.promotion?.applied, 'Candidate already applied', 'PROMOTION_ALREADY_APPLIED');
        await checkDrift(workflow, this.gateway.store, state);
        const governance = await workflow.repository.loadGovernance(item.project);
        invariant(hashObject(governance) === state.governanceHash && hashObject(await workflow.repository.loadRegistry()) === state.registryHash, 'Governance changed', 'GOVERNANCE_STALE');
        invariant(item.selectedProfile === state.manifest.riskProfile, 'Risk profile changed', 'RISK_STALE');
        invariant(state.baselineCommit && await new GitInspector(state.repository).baselineCommit() === state.baselineCommit, 'Baseline commit changed or missing', 'BASELINE_STALE');
        invariant(state.approvalContextHash === hashObject([item.artifacts.specification ?? null, item.artifacts.plan ?? null, item.artifacts['architecture-impact'] ?? null]), 'Specification or plan changed', 'APPROVAL_STALE');
        for (const [kind, action] of [['specification', 'ACCEPT_SPECIFICATION'], ['plan', 'APPROVE_PLAN']]) {
            const artifact = item.artifacts[kind];
            invariant(artifact && validApproval(item.confirmations, action, artifact), 'Current specification and plan approval required', 'APPROVAL_STALE');
            invariant(sha256(await workflow.repository.readArtifact(item.id, kind)) === artifact.sha256, 'Artifact content changed', 'APPROVAL_STALE');
        }
        const manifest = await workflow.capabilities(item.id);
        invariant(capabilityManifestHash(manifest) === item.capabilityManifestHash, 'Stale capability manifest', 'MANIFEST_STALE');
        const current = await snapshot(state.workspace);
        const snapshotHash = hashObject(current);
        invariant(state.validation?.passed && state.validation.snapshotHash === snapshotHash && state.validation.governanceHash === state.governanceHash, 'Current passing validation required', 'VALIDATION_STALE');
        const required = requiredCommandIds(governance);
        invariant(required.every((name) => state.validation.commands.includes(name)), 'Required command evidence missing', 'COMMAND_EVIDENCE_REQUIRED');
        invariant(item.validations.every((record) => record.stale || record.outcome === 'PASS'), 'Failed validation blocks promotion', 'VALIDATION_FAILED');
        const baseline = state.sourceBaseline ?? Object.fromEntries(Object.entries(state.baseline).filter(([path]) => classifiedScope(governance, path) && governance.dataClassification !== 'CONFIDENTIAL'));
        const paths = changedPaths(baseline, current);
        const assessed = classifyRisk({ ...item.risk.input, affectedPaths: paths, dependencyChanges: paths.filter((path) => /(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements.*\.txt|\.csproj|packages\.lock\.json)$/.test(path)) }, governance);
        invariant(!isHigherProfile(assessed.minimumProfile, item.selectedProfile), 'Candidate increases risk', 'RISK_INCREASED');
        const changes = [];
        for (const path of paths) {
            invariant(classifiedScope(governance, path) && (item.risk.input.affectedPaths ?? []).some((pattern) => globMatches(path, pattern)), 'Patch contains unapproved paths', 'PATCH_SCOPE_DENIED');
            const before = baseline[path] ? await readFile(await safePath(state.hostRoot, path)) : Buffer.alloc(0);
            const after = current[path] ? await readFile(await safePath(state.workspace, path)) : Buffer.alloc(0);
            invariant(!before.includes(0) && !after.includes(0), 'Binary promotion is unsupported', 'PATCH_BINARY');
            // Whole-file patch records intentionally replace text as one hunk; counts reflect that representation.
            changes.push({ path, before: baseline[path]?.sha256 ?? null, after: current[path]?.sha256 ?? null, additions: after.length ? after.toString('utf8').split('\n').length : 0, deletions: before.length ? before.toString('utf8').split('\n').length : 0 });
        }
        const reviewValid = state.review?.approved && item.review?.stale === false && state.review.snapshotHash === snapshotHash && state.review.reviewSessionId === item.review.reviewSessionId && state.review.findingsHash === item.review.findingsHash && state.review.handoffHash === state.handoff?.contentHash && state.review.handoffHash === item.review.handoffHash && state.review.reviewer === item.review.reviewer;
        if (requireReview)
            invariant(reviewValid && item.review?.outcome === 'APPROVED' && item.review.independent && (item.selectedProfile !== 'HIGH_RISK' || item.review.humanReviewed) && item.state === 'READY_FOR_REVIEW', 'Independent human-reviewed current candidate required', 'REVIEW_REQUIRED');
        await workflow.verifyEvidence();
        await requirePolicy(this.gateway.policy, { schemaVersion: 1, action: 'promotion.apply', workItem: item.id, project: item.project, stage: item.state, riskProfile: item.selectedProfile, governanceHash: state.governanceHash, manifestHash: item.capabilityManifestHash, fresh: true, suspended: false, coreAllow: true, projectAllow: true, workItemAllow: true, stageAllow: ['IMPLEMENTING', 'VALIDATING', 'READY_FOR_REVIEW'].includes(item.state), riskAllow: true, confirmationRequired: false });
        const unsigned = { workItem: item.id, project: item.project, riskProfile: item.selectedProfile, targetRepository: state.hostRoot, baselineCommit: state.baselineCommit, changes, validation: 'PASS', review: reviewValid ? 'APPROVED' : 'REQUIRED', policy: 'ALLOW', snapshotHash };
        return { state, current, summary: { ...unsigned, confirmationHash: hashObject(unsigned) } };
    }
    async preview() { return (await this.inspect(true)).summary; }
    async apply(confirmation) {
        return this.gateway.store.exclusive(async () => {
            const { state, current, summary } = await this.inspect(true);
            human(confirmation, summary.confirmationHash);
            const host = new GovernedFiles(state.hostRoot);
            const rollback = [];
            const journalPath = join(this.gateway.store.directory, 'promotion-journal.json');
            const createdAt = new Date().toISOString();
            const journal = { schemaVersion: 1, transactionId: randomUUID(), workItem: state.workItem, sessionId: state.id, confirmationHash: summary.confirmationHash, snapshotHash: summary.snapshotHash, state: 'INTENT', changes: summary.changes.map((change) => ({ path: change.path, before: change.before, after: change.after, applied: false, createdDirectories: [] })), createdAt, updatedAt: createdAt };
            await writeJsonAtomic(journalPath, journal);
            // Preload and verify all candidate bytes before the first target mutation.
            const content = new Map();
            for (const change of summary.changes)
                if (change.after) {
                    const data = await readFile(await safePath(state.workspace, change.path));
                    invariant(sha256(data) === change.after, 'Candidate changed', 'PATCH_STALE');
                    content.set(change.path, data.toString('utf8'));
                }
            await this.gateway.audit('PROMOTION_INTENT', { confirmationHash: summary.confirmationHash, paths: summary.changes.map((change) => change.path), actor: confirmation.localOsUser });
            try {
                for (const change of summary.changes) {
                    journal.state = 'APPLYING';
                    journal.updatedAt = new Date().toISOString();
                    await writeJsonAtomic(journalPath, journal);
                    const before = change.before ? (await host.read(change.path)).content : null;
                    const applied = await host.mutate(change.before === null ? 'create' : change.after === null ? 'delete' : 'replace', change.path, change.before, content.get(change.path));
                    rollback.push({ path: change.path, before, afterHash: change.after, createdDirectories: applied.createdDirectories });
                    const journalChange = journal.changes.find((entry) => entry.path === change.path);
                    journalChange.applied = true;
                    journalChange.createdDirectories = applied.createdDirectories;
                    journal.updatedAt = new Date().toISOString();
                    await writeJsonAtomic(journalPath, journal);
                }
                const expected = { ...state.expectedHost };
                for (const change of summary.changes) {
                    if (current[change.path])
                        expected[change.path] = current[change.path];
                    else
                        delete expected[change.path];
                }
                invariant(changedPaths(expected, await snapshot(state.hostRoot)).length === 0, 'Concurrent target drift during promotion', 'HOST_DRIFT');
                const appliedAt = new Date().toISOString();
                const receipt = parseDeliveryReceipt({ schemaVersion: 1, transactionId: journal.transactionId, workItem: state.workItem, project: summary.project, sessionId: state.id, snapshotHash: summary.snapshotHash, confirmationHash: summary.confirmationHash, targetRoot: state.hostRoot, changeHash: hashObject(summary.changes.map(({ path, before, after }) => ({ path, before, after }))), noChange: summary.changes.length === 0, appliedAt });
                const receiptHash = hashObject(receipt);
                await writeJsonAtomic(join(this.gateway.workflow.repository.workItemDirectory(state.workItem), 'delivery-receipt.json'), receipt);
                state.expectedHost = expected;
                state.promotion = { confirmationHash: summary.confirmationHash, applied: true, receiptHash, transactionId: journal.transactionId, snapshotHash: summary.snapshotHash, appliedAt };
                journal.state = 'APPLIED';
                journal.updatedAt = appliedAt;
                await writeJsonAtomic(journalPath, journal);
                await this.gateway.store.save(state);
                await this.gateway.audit('PROMOTION_APPLIED', { transaction: journal.transactionId, confirmationHash: summary.confirmationHash, snapshotHash: summary.snapshotHash });
                await unlink(journalPath);
                return summary;
            }
            catch (error) {
                let restored = true;
                journal.state = 'ROLLING_BACK';
                journal.updatedAt = new Date().toISOString();
                await writeJsonAtomic(journalPath, journal);
                for (const change of rollback.reverse()) {
                    try {
                        await host.mutate(change.before === null ? 'delete' : change.afterHash === null ? 'create' : 'replace', change.path, change.afterHash, change.before ?? undefined);
                        await removeCreatedDirectories(state.hostRoot, change.createdDirectories);
                    }
                    catch {
                        restored = false;
                    }
                }
                journal.state = restored ? 'ROLLED_BACK' : 'ROLLING_BACK';
                journal.updatedAt = new Date().toISOString();
                await writeJsonAtomic(journalPath, journal);
                const item = await this.gateway.workflow.status(state.workItem);
                item.suspension = { active: true, reason: restored ? 'PROMOTION_ROLLED_BACK' : 'PROMOTION_RECOVERY_REQUIRED', timestamp: new Date().toISOString() };
                await this.gateway.workflow.repository.saveWorkItem(item);
                await this.gateway.audit('PROMOTION_FAILED', { transaction: journal.transactionId, rollbackComplete: restored });
                throw error;
            }
        });
    }
}
//# sourceMappingURL=promotion.js.map