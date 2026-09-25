import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EvidenceLog } from '../evidence/evidence.js';
import { parseDeliveryReceipt, parsePromotionJournal, parseSessionRecord, parseSessionTransaction } from '../schemas/validation.js';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { readJson, writeJsonAtomic } from '../shared/fs.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { changedPaths, GovernedFiles, safePath, snapshot } from './files.js';
import { SessionStore } from './session.js';
async function journal(store) { try {
    return parsePromotionJournal(await readJson(join(store.directory, 'promotion-journal.json')));
}
catch (error) {
    if (error.code === 'ENOENT')
        return undefined;
    throw error;
} }
export async function inspectRecovery(root) {
    const repository = new WorkflowRepository(root);
    const entries = [];
    for (const item of await repository.listWorkItems())
        if (item.enforcementSession) {
            const store = new SessionStore(item.enforcementSession);
            const pending = await journal(store);
            if (pending)
                entries.push({ kind: 'PROMOTION', workItem: item.id, transactionId: pending.transactionId, state: pending.state, session: store.directory, action: pending.state === 'ROLLED_BACK' ? 'FINALIZE_ROLLBACK' : 'RESUME' });
        }
    const directory = join(root, '.ai-delivery', 'transactions');
    const files = await readdir(directory).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
    for (const file of files.filter((name) => /^session-[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(name)).sort()) {
        const pending = parseSessionTransaction(await readJson(join(directory, file)));
        const item = await repository.loadWorkItem(pending.workItem);
        invariant(item.project === pending.project, 'Session recovery project binding changed', 'RECOVERY_STALE');
        const bound = item.enforcementSession === pending.newSession.directory && item.enforcementEpoch === pending.newSession.epoch;
        invariant(bound || item.revision === pending.expectedRevision && (item.enforcementEpoch ?? 0) === pending.expectedEpoch, 'Session recovery conflicts with newer work-item state', 'RECOVERY_STALE');
        entries.push({ kind: 'SESSION_BINDING', workItem: pending.workItem, transactionId: pending.transactionId, state: pending.state, session: pending.newSession.directory, action: bound ? 'FINALIZE' : 'RESUME' });
    }
    const unsigned = { root, entries };
    return { ...unsigned, planHash: hashObject(unsigned) };
}
export async function applyRecovery(root, acceptedPlanHash) {
    const plan = await inspectRecovery(root);
    invariant(plan.planHash === acceptedPlanHash, 'Recovery plan changed after review', 'RECOVERY_PLAN_STALE');
    const repository = new WorkflowRepository(root);
    for (const entry of plan.entries)
        await repository.exclusiveCommit(async () => {
            if (entry.kind === 'SESSION_BINDING') {
                await recoverSessionBinding(repository, entry);
                return;
            }
            const item = await repository.loadWorkItem(entry.workItem);
            invariant(item.enforcementSession === entry.session, 'Recovery session is no longer active', 'RECOVERY_STALE');
            const store = new SessionStore(entry.session);
            const pending = await journal(store);
            invariant(pending?.transactionId === entry.transactionId, 'Recovery journal changed', 'RECOVERY_STALE');
            if (pending.state === 'ROLLED_BACK') {
                item.suspension = { active: false, reason: 'RECOVERY_CONFIRMED_ROLLBACK', timestamp: new Date().toISOString() };
                await repository.saveWorkItem(item);
                await unlink(join(store.directory, 'promotion-journal.json'));
                return;
            }
            const state = await store.read();
            invariant(state.id === pending.sessionId && hashObject(await snapshot(state.workspace)) === pending.snapshotHash, 'Recovery candidate is stale', 'RECOVERY_STALE');
            const host = new GovernedFiles(state.hostRoot);
            for (const change of pending.changes) {
                const current = (await snapshot(state.hostRoot))[change.path]?.sha256 ?? null;
                if (current === change.after) {
                    change.applied = true;
                    continue;
                }
                invariant(current === change.before, `Promotion recovery conflict at ${change.path}`, 'PROMOTION_RECOVERY_CONFLICT');
                const content = change.after ? await readFile(await safePath(state.workspace, change.path), 'utf8') : undefined;
                if (content !== undefined)
                    invariant(sha256(content) === change.after, 'Recovery candidate content changed', 'RECOVERY_STALE');
                const applied = await host.mutate(change.before === null ? 'create' : change.after === null ? 'delete' : 'replace', change.path, change.before, content);
                change.applied = true;
                change.createdDirectories = applied.createdDirectories;
            }
            const expected = { ...state.expectedHost };
            const candidate = await snapshot(state.workspace);
            for (const change of pending.changes) {
                if (candidate[change.path])
                    expected[change.path] = candidate[change.path];
                else
                    delete expected[change.path];
            }
            invariant(changedPaths(expected, await snapshot(state.hostRoot)).length === 0, 'Recovered delivery does not match the candidate', 'PROMOTION_RECOVERY_CONFLICT');
            const appliedAt = new Date().toISOString();
            const receipt = parseDeliveryReceipt({ schemaVersion: 1, transactionId: pending.transactionId, workItem: item.id, project: item.project, sessionId: state.id, snapshotHash: pending.snapshotHash, confirmationHash: pending.confirmationHash, targetRoot: state.hostRoot, changeHash: hashObject(pending.changes.map(({ path, before, after }) => ({ path, before, after }))), noChange: pending.changes.length === 0, appliedAt });
            const receiptHash = hashObject(receipt);
            await writeJsonAtomic(join(repository.workItemDirectory(item.id), 'delivery-receipt.json'), receipt);
            state.expectedHost = expected;
            state.promotion = { confirmationHash: pending.confirmationHash, applied: true, receiptHash, transactionId: pending.transactionId, snapshotHash: pending.snapshotHash, appliedAt };
            await store.save(state);
            item.suspension = { active: false, reason: 'PROMOTION_RECOVERED', timestamp: new Date().toISOString() };
            await repository.saveWorkItem(item);
            await new EvidenceLog(repository.evidencePath()).append({ type: 'PROMOTION_RECOVERED', timestamp: new Date().toISOString(), workItem: item.id, project: item.project, data: { transaction: pending.transactionId, snapshotHash: pending.snapshotHash } });
            await unlink(join(store.directory, 'promotion-journal.json'));
        });
    return inspectRecovery(root);
}
async function recoverSessionBinding(repository, entry) {
    const path = join(repository.gitRoot, '.ai-delivery', 'transactions', `session-${entry.workItem}.json`);
    const pending = parseSessionTransaction(await readJson(path));
    invariant(pending.transactionId === entry.transactionId && pending.newSession.directory === entry.session, 'Session transaction changed', 'RECOVERY_STALE');
    const state = parseSessionRecord(await readJson(join(entry.session, 'session.json')));
    invariant(state.id === pending.newSession.id && state.epoch === pending.newSession.epoch && state.workItem === entry.workItem, 'Prepared session transaction is invalid', 'RECOVERY_STALE');
    const item = await repository.loadWorkItem(entry.workItem);
    const bound = item.enforcementSession === entry.session && item.enforcementEpoch === pending.newSession.epoch;
    if (!bound) {
        invariant(item.revision === pending.expectedRevision && (item.enforcementEpoch ?? 0) === pending.expectedEpoch, 'Work item changed after session intent', 'RECOVERY_STALE');
        item.validations.forEach((validation) => { validation.stale = true; });
        if (item.review) {
            item.review.stale = true;
            item.review.staleReason = 'session transaction recovered';
        }
        item.enforcementSession = entry.session;
        item.enforcementEpoch = pending.newSession.epoch;
        delete item.reviewSession;
        delete item.recoverableCandidateSession;
        await repository.saveWorkItem(item);
    }
    for (const old of [pending.previousSession, pending.previousReviewSession])
        if (old && old !== entry.session) {
            try {
                const record = parseSessionRecord(await readJson(join(old, 'session.json')));
                if (!record.closed || !record.revokedAt) {
                    record.closed = true;
                    record.revokedAt = new Date().toISOString();
                    record.revokedReason = 'SESSION_REPLACED_RECOVERED';
                    delete record.validation;
                    delete record.review;
                    delete record.reviewSubmission;
                    record.revision += 1;
                    await writeJsonAtomic(join(old, 'session.json'), parseSessionRecord(record));
                }
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
    const evidence = new EvidenceLog(repository.evidencePath());
    const exists = (await evidence.read()).some((event) => event.type === 'SESSION_PREPARED' && event.data.transaction === pending.transactionId);
    if (!exists)
        await evidence.append({ type: 'SESSION_PREPARED', timestamp: pending.createdAt, workItem: item.id, project: item.project, data: { session: state.id, epoch: state.epoch, role: state.role, isolation: state.mode, manifestHash: state.manifestHash, expiresAt: state.expiresAt, transaction: pending.transactionId, recovered: true } });
    await unlink(path);
}
//# sourceMappingURL=recovery.js.map