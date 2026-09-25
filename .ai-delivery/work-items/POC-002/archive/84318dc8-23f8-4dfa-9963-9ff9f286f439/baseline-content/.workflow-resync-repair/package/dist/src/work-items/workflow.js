import { userInfo } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capabilityManifestHash, calculateCapabilities } from '../capabilities/capabilities.js';
import { createConfirmation, invalidateApprovals, validApproval } from '../approvals/approvals.js';
import { EvidenceLog } from '../evidence/evidence.js';
import { requireArtifact, revisionTransition, stateAtLeast, transition } from '../lifecycle/lifecycle.js';
import { classifyRisk, assertDowngradeAllowed, isHigherProfile, maximumProfile } from '../risk/risk.js';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { requiredCommandIds } from '../validation/requirements.js';
import { readJson } from '../shared/fs.js';
import { parseDeliveryReceipt } from '../schemas/validation.js';
import { requireCurrentHandoff, reviewConfirmationHash } from '../enforcement/bindings.js';
export class Workflow {
    repository;
    evidence;
    now;
    actor;
    constructor(repository, dependencies = {}) {
        this.repository = repository;
        this.evidence = new EvidenceLog(repository.evidencePath());
        this.now = dependencies.now ?? (() => new Date().toISOString());
        this.actor = dependencies.actor ?? (() => userInfo().username);
    }
    async governance(item) { return this.repository.loadGovernance(item.project); }
    async persist(item, governance) {
        invariant(!item.suspension?.active, 'Workflow is suspended; investigate and resynchronize', 'WORKFLOW_SUSPENDED');
        const policy = governance ?? await this.governance(item);
        item.capabilityManifestHash = capabilityManifestHash(calculateCapabilities({ workItem: item.id, project: item.project, stage: item.state, riskProfile: item.selectedProfile, governance: policy }));
        await this.repository.saveWorkItem(item);
        return item;
    }
    async record(item, type, data = {}) {
        await this.evidence.append({ type, timestamp: this.now(), workItem: item.id, project: item.project, lifecycleState: item.state, data });
    }
    async move(item, to, governance) {
        const from = item.state;
        item.state = transition(from, to);
        await this.persist(item, governance);
        await this.record(item, 'STATE_TRANSITION', { from, to });
        return item;
    }
    async create(input) {
        await this.repository.loadGovernance(input.project);
        try {
            await this.repository.loadWorkItem(input.id);
            invariant(false, `Work item already exists: ${input.id}`, 'WORK_EXISTS');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const governance = await this.repository.loadGovernance(input.project);
        const risk = classifyRisk(input.risk ?? {}, governance);
        const selectedProfile = maximumProfile(input.profile ?? 'STANDARD', risk.minimumProfile);
        const item = {
            schemaVersion: 2, gateVersion: 1, id: input.id, project: input.project, ticket: input.ticket ?? '', createdAt: this.now(), createdBy: this.actor(), state: 'DISCOVERING',
            selectedProfile, risk, artifacts: {}, confirmations: [], validations: [], capabilityManifestHash: '', revision: 0, enforcementEpoch: 0,
        };
        await this.persist(item, governance);
        await this.record(item, 'WORK_ITEM_CREATED', { profile: selectedProfile, minimumProfile: risk.minimumProfile });
        return item;
    }
    async status(id) { return this.repository.loadWorkItem(id); }
    async capabilities(id) { const item = await this.status(id); return calculateCapabilities({ workItem: item.id, project: item.project, stage: item.state, riskProfile: item.selectedProfile, governance: await this.governance(item) }); }
    async submitArtifact(id, type, content) {
        invariant(content.trim().length > 0, `${type} artefact cannot be empty`, 'ARTEFACT_EMPTY');
        const item = await this.status(id);
        const hash = sha256(content);
        const existing = item.artifacts[type];
        const changed = existing?.sha256 !== hash;
        invariant(!item.suspension?.active, 'Workflow is suspended', 'WORKFLOW_SUSPENDED');
        if (!changed)
            return { item, changed: false };
        const timestamp = this.now();
        await this.repository.writeArtifact(id, type, content);
        item.artifacts[type] = { type, relativePath: `.ai-delivery/work-items/${id}/${type}.md`, sha256: hash, updatedAt: timestamp };
        let stale = 0;
        if (type === 'specification') {
            stale = invalidateApprovals(item.confirmations, ['ACCEPT_SPECIFICATION', 'APPROVE_PLAN'], 'specification changed');
            item.validations.forEach((entry) => { entry.stale = true; });
            if (stateAtLeast(item.state, 'SPEC_ACCEPTED'))
                item.state = 'SPEC_DRAFT';
        }
        if (type === 'plan') {
            stale = invalidateApprovals(item.confirmations, ['APPROVE_PLAN'], 'plan changed');
            item.validations.forEach((entry) => { entry.stale = true; });
            if (stateAtLeast(item.state, 'PLAN_APPROVED'))
                item.state = 'PLANNING';
        }
        if (type === 'architecture-impact') {
            stale = invalidateApprovals(item.confirmations, ['APPROVE_ARCHITECTURE', 'APPROVE_PLAN'], 'architecture impact changed');
            item.validations.forEach((entry) => { entry.stale = true; });
            if (stateAtLeast(item.state, 'PLANNING'))
                item.state = 'SPEC_ACCEPTED';
        }
        if (item.review) {
            item.review.stale = true;
            item.review.staleReason = `${type} changed`;
        }
        await this.persist(item);
        await this.record(item, 'ARTEFACT_SUBMITTED', { artifactType: type, sha256: hash, approvalsInvalidated: stale });
        return { item, changed: true };
    }
    async submitDiscovery(id, content) {
        const item = await this.status(id);
        invariant(item.state === 'DISCOVERING', 'Discovery can only be submitted while DISCOVERING', 'STATE_REQUIREMENT');
        await this.submitArtifact(id, 'discovery', content);
        return this.move(await this.status(id), 'SPEC_DRAFT');
    }
    async submitSpecification(id, content) {
        const item = await this.status(id);
        invariant(stateAtLeast(item.state, 'SPEC_DRAFT') && item.state !== 'COMPLETE', 'Specification cannot be submitted in this state', 'STATE_REQUIREMENT');
        return (await this.submitArtifact(id, 'specification', content)).item;
    }
    confirmationRequired(profile, lightweightSetting) { return profile !== 'LIGHTWEIGHT' || lightweightSetting; }
    async acceptSpecification(id, confirmation) {
        const item = await this.status(id);
        invariant(item.state === 'SPEC_DRAFT', 'Specification acceptance requires SPEC_DRAFT', 'STATE_REQUIREMENT');
        requireArtifact(item, 'discovery');
        requireArtifact(item, 'specification');
        const governance = await this.governance(item);
        const artifact = item.artifacts.specification;
        if (this.confirmationRequired(item.selectedProfile, governance.confirmations.lightweightSpecification)) {
            invariant(confirmation, 'Specification requires human confirmation', 'CONFIRMATION_REQUIRED');
            const record = createConfirmation(confirmation, { workItemId: id, action: 'ACCEPT_SPECIFICATION', project: item.project, riskProfile: item.selectedProfile, timestamp: this.now(), artifact });
            item.confirmations.push(record);
            await this.record(item, 'HUMAN_CONFIRMED', { action: record.action, artifactType: artifact.type, sha256: artifact.sha256, localOsUser: record.localOsUser });
        }
        return this.move(item, 'SPEC_ACCEPTED', governance);
    }
    async submitArchitecture(id, content) {
        const item = await this.status(id);
        invariant(stateAtLeast(item.state, 'SPEC_ACCEPTED') && item.state !== 'COMPLETE', 'Architecture impact requires accepted specification', 'STATE_REQUIREMENT');
        return (await this.submitArtifact(id, 'architecture-impact', content)).item;
    }
    async approveArchitecture(id, confirmation) {
        const item = await this.status(id);
        invariant(item.selectedProfile === 'HIGH_RISK', 'Architecture approval is only required for HIGH_RISK', 'PROFILE_REQUIREMENT');
        requireArtifact(item, 'architecture-impact');
        const artifact = item.artifacts['architecture-impact'];
        const record = createConfirmation(confirmation, { workItemId: id, action: 'APPROVE_ARCHITECTURE', project: item.project, riskProfile: item.selectedProfile, timestamp: this.now(), artifact });
        item.confirmations.push(record);
        await this.persist(item);
        await this.record(item, 'HUMAN_CONFIRMED', { action: record.action, artifactType: artifact.type, sha256: artifact.sha256, localOsUser: record.localOsUser });
        return item;
    }
    requireCurrentApproval(item, action, artifact) { invariant(validApproval(item.confirmations, action, artifact), `Current ${artifact.type} approval is required`, 'APPROVAL_REQUIRED_OR_STALE'); }
    async submitPlan(id, content) {
        let item = await this.status(id);
        invariant(stateAtLeast(item.state, 'SPEC_ACCEPTED') && item.state !== 'COMPLETE', 'Plan submission requires an accepted specification', 'STATE_REQUIREMENT');
        requireArtifact(item, 'specification');
        const governance = await this.governance(item);
        if (this.confirmationRequired(item.selectedProfile, governance.confirmations.lightweightSpecification))
            this.requireCurrentApproval(item, 'ACCEPT_SPECIFICATION', item.artifacts.specification);
        if (item.selectedProfile === 'HIGH_RISK') {
            requireArtifact(item, 'architecture-impact');
            this.requireCurrentApproval(item, 'APPROVE_ARCHITECTURE', item.artifacts['architecture-impact']);
        }
        if (item.state === 'SPEC_ACCEPTED')
            item = await this.move(item, 'PLANNING', governance);
        return (await this.submitArtifact(id, 'plan', content)).item;
    }
    async approvePlan(id, confirmation) {
        const item = await this.status(id);
        invariant(item.state === 'PLANNING', 'Plan approval requires PLANNING', 'STATE_REQUIREMENT');
        requireArtifact(item, 'plan');
        const governance = await this.governance(item);
        const artifact = item.artifacts.plan;
        if (this.confirmationRequired(item.selectedProfile, governance.confirmations.lightweightPlan)) {
            invariant(confirmation, 'Plan requires human confirmation', 'CONFIRMATION_REQUIRED');
            const record = createConfirmation(confirmation, { workItemId: id, action: 'APPROVE_PLAN', project: item.project, riskProfile: item.selectedProfile, timestamp: this.now(), artifact });
            item.confirmations.push(record);
            await this.record(item, 'HUMAN_CONFIRMED', { action: record.action, artifactType: artifact.type, sha256: artifact.sha256, localOsUser: record.localOsUser });
        }
        return this.move(item, 'PLAN_APPROVED', governance);
    }
    async beginImplementation(id) {
        const item = await this.status(id);
        invariant(item.state === 'PLAN_APPROVED', 'Implementation requires PLAN_APPROVED', 'STATE_REQUIREMENT');
        requireArtifact(item, 'plan');
        const governance = await this.governance(item);
        if (this.confirmationRequired(item.selectedProfile, governance.confirmations.lightweightPlan))
            this.requireCurrentApproval(item, 'APPROVE_PLAN', item.artifacts.plan);
        if (item.selectedProfile === 'HIGH_RISK')
            this.requireCurrentApproval(item, 'APPROVE_ARCHITECTURE', item.artifacts['architecture-impact']);
        const { requireCurrentSession, refreshCurrentSession } = await import('../enforcement/session.js');
        const enforcement = await requireCurrentSession(this, item, ['implementation']);
        const moved = await this.move(item, 'IMPLEMENTING', governance);
        await refreshCurrentSession(this, moved, enforcement.store, 'implementation');
        await this.record(moved, 'IMPLEMENTATION_SESSION_BOUND', { session: enforcement.state.id, isolation: enforcement.state.mode });
        return moved;
    }
    async beginValidation(id) {
        let item = await this.status(id);
        invariant(item.state === 'IMPLEMENTING' || item.state === 'VALIDATING', 'Validation requires IMPLEMENTING or VALIDATING', 'STATE_REQUIREMENT');
        const { requireCurrentSession, refreshCurrentSession } = await import('../enforcement/session.js');
        const enforcement = await requireCurrentSession(this, item, item.state === 'IMPLEMENTING' ? ['implementation'] : ['validation']);
        await requireCurrentHandoff(enforcement.store, enforcement.state);
        if (item.state === 'IMPLEMENTING') {
            item = await this.move(item, 'VALIDATING');
            await refreshCurrentSession(this, item, enforcement.store, 'validation');
        }
        return item;
    }
    async reviseImplementation(id, reason) {
        const item = await this.status(id);
        invariant(item.state === 'VALIDATING', 'Revision requires a failed validation or rejected review in VALIDATING', 'STATE_REQUIREMENT');
        invariant(reason.trim().length > 0, 'Revision reason is required', 'REVISION_REASON_REQUIRED');
        const { createSession, requireCurrentSession } = await import('../enforcement/session.js');
        const current = await requireCurrentSession(this, item, ['validation']);
        invariant(current.state.validation?.passed !== true || item.review?.outcome === 'CHANGES_REQUESTED', 'Current candidate has no failed result requiring revision', 'REVISION_NOT_REQUIRED');
        item.validations.forEach((entry) => { entry.stale = true; });
        if (item.review) {
            item.review.stale = true;
            item.review.staleReason = reason;
        }
        const from = item.state;
        item.state = revisionTransition(item.state);
        await this.persist(item);
        await this.record(item, 'REVISION_TRANSITION', { from, to: item.state, reason });
        const replacement = await createSession(this, id, { seedStore: current.store });
        const revised = await this.status(id);
        await this.record(revised, 'REVISION_SESSION_CREATED', { session: (await replacement.load()).id, epoch: revised.enforcementEpoch, previousSession: current.state.id, reason });
        return revised;
    }
    async recordValidation(id) {
        const item = await this.status(id);
        invariant(item.state === 'VALIDATING', 'Validation recording requires VALIDATING', 'STATE_REQUIREMENT');
        const { requireCurrentSession } = await import('../enforcement/session.js');
        const enforcement = await requireCurrentSession(this, item, ['validation']);
        const validation = enforcement.state.validation;
        invariant(validation?.passed && validation.snapshotHash === enforcement.evidence.snapshotHash && validation.governanceHash === enforcement.state.governanceHash && validation.resultHash && validation.validatedAt, 'Current governed execution receipt is required', 'SESSION_VALIDATION_REQUIRED');
        const governance = await this.governance(item);
        const commandResults = validation.commandResults ?? [];
        invariant(validation.changedPaths && validation.resultHash === hashObject({ sessionId: enforcement.state.id, snapshotHash: validation.snapshotHash, governanceHash: validation.governanceHash, manifestHash: enforcement.state.manifestHash, changedPaths: validation.changedPaths, commands: validation.commands, commandResults }), 'Final validation execution receipt is invalid', 'SESSION_VALIDATION_REQUIRED');
        const implementationManifestHash = capabilityManifestHash(calculateCapabilities({ workItem: item.id, project: item.project, stage: 'IMPLEMENTING', riskProfile: item.selectedProfile, governance }));
        invariant(validation.commands.every((command) => commandResults.some((result) => result.command === command && result.status === 'PASSED' && result.sessionId === enforcement.state.id && result.snapshotHash === enforcement.evidence.snapshotHash && result.governanceHash === enforcement.state.governanceHash && [implementationManifestHash, enforcement.state.manifestHash].includes(result.manifestHash) && result.definitionHash === hashObject(governance.commands[command]) && /^[a-f0-9]{64}$/.test(result.outputHash) && /^[a-f0-9]{64}$/.test(result.logHash) && Number.isFinite(Date.parse(result.startedAt)) && Number.isFinite(Date.parse(result.completedAt)))), 'Command result receipt is missing or stale', 'COMMAND_EVIDENCE_REQUIRED');
        item.validations.forEach((entry) => { if (!entry.stale)
            entry.stale = true; });
        const records = commandResults.filter((result) => result.status === 'PASSED' && validation.commands.includes(result.command)).map((result) => ({ name: result.command, outcome: 'PASS', summary: `Governed command completed: ${result.command}`, policyValidation: governance.validation.policyCommands.includes(result.command), timestamp: result.completedAt, stale: false, enforcement: enforcement.evidence, execution: { kind: 'COMMAND', outputHash: result.outputHash } }));
        records.push({ name: 'diff', outcome: 'PASS', summary: 'Governed final diff and evidence validation completed', policyValidation: false, timestamp: validation.validatedAt, stale: false, enforcement: enforcement.evidence, execution: { kind: 'FINAL_DIFF', outputHash: validation.resultHash } });
        if (item.selectedProfile === 'HIGH_RISK' && governance.validation.requirePolicyValidationForHighRisk)
            records.push({ name: 'policy', outcome: 'PASS', summary: 'Built-in policy engine authorized the final candidate and evidence checks', policyValidation: true, timestamp: validation.validatedAt, stale: false, enforcement: enforcement.evidence, execution: { kind: 'FINAL_DIFF', outputHash: validation.resultHash } });
        item.validations.push(...records);
        await this.persist(item);
        for (const record of records)
            await this.record(item, 'VALIDATION_RECORDED', { name: record.name, outcome: record.outcome, policyValidation: record.policyValidation, executionKind: record.execution.kind, outputHash: record.execution.outputHash, session: enforcement.state.id, snapshotHash: enforcement.evidence.snapshotHash });
        return item;
    }
    async recordReview(id, reviewSessionDirectory, confirmation) {
        let item = await this.status(id);
        invariant(item.state === 'VALIDATING', 'Review recording requires VALIDATING', 'STATE_REQUIREMENT');
        const governance = await this.governance(item);
        const { SessionStore, createSession, requireCurrentSession, requireSession, refreshCurrentSession, revokeSession } = await import('../enforcement/session.js');
        let enforcement = await requireCurrentSession(this, item, ['validation']);
        const sourceHandoff = await requireCurrentHandoff(enforcement.store, enforcement.state);
        const reviewStore = new SessionStore(reviewSessionDirectory);
        const initialReviewState = await reviewStore.load();
        const reviewState = (await requireSession(this, item, reviewStore, ['review'])).state;
        const submission = reviewState.reviewSubmission;
        const reviewHandoff = await requireCurrentHandoff(reviewStore, reviewState);
        invariant(reviewState.role === 'review' && reviewState.reviewOf === enforcement.state.id && reviewState.id !== enforcement.state.id, 'Fresh independent review session required', 'REVIEW_SESSION_REQUIRED');
        invariant(submission && submission.sourceSession === enforcement.state.id && submission.snapshotHash === enforcement.evidence.snapshotHash && submission.governanceHash === enforcement.state.governanceHash && submission.manifestHash === enforcement.state.manifestHash && submission.handoffHash === sourceHandoff.metadata.contentHash && submission.handoffHash === reviewHandoff.metadata.contentHash && submission.confirmationHash === reviewConfirmationHash(reviewState.id, { ...submission, handoffHash: submission.handoffHash }) && hashObject(await import('../enforcement/files.js').then(({ snapshot }) => snapshot(reviewState.workspace))) === enforcement.evidence.snapshotHash, 'Review submission is not bound to the current candidate and handoff', 'REVIEW_SESSION_STALE');
        invariant(enforcement.state.validation?.passed && enforcement.state.validation.snapshotHash === enforcement.evidence.snapshotHash, 'Review requires current governed validation evidence', 'SESSION_VALIDATION_REQUIRED');
        const currentValidations = item.validations.filter((entry) => !entry.stale && entry.outcome === 'PASS' && entry.enforcement?.sessionId === enforcement.state.id && entry.enforcement.snapshotHash === enforcement.evidence.snapshotHash && entry.enforcement.governanceHash === enforcement.state.governanceHash && entry.enforcement.manifestHash === enforcement.state.manifestHash);
        invariant(currentValidations.length > 0, 'At least one current session-bound passing validation is required', 'VALIDATION_REQUIRED');
        if (item.selectedProfile === 'LIGHTWEIGHT')
            invariant(currentValidations.some((entry) => entry.name === 'diff'), 'Passing final diff validation is required for LIGHTWEIGHT', 'DIFF_VALIDATION_REQUIRED');
        for (const name of requiredCommandIds(governance))
            invariant(currentValidations.some((entry) => entry.name === name), `Required validation has not passed for the current session: ${name}`, 'VALIDATION_REQUIRED');
        if (item.selectedProfile === 'HIGH_RISK' && governance.validation.requirePolicyValidationForHighRisk)
            invariant(currentValidations.some((entry) => entry.policyValidation), 'Passing current session-bound policy validation is required', 'POLICY_VALIDATION_REQUIRED');
        let humanReviewer;
        if (item.selectedProfile === 'HIGH_RISK') {
            invariant(confirmation?.confirmed && confirmation.interactive && confirmation.localOsUser.trim() && confirmation.presentedArtifactSha256 === submission.confirmationHash, 'Exact interactive human review confirmation required', 'HUMAN_REVIEW_REQUIRED');
            humanReviewer = confirmation.localOsUser;
        }
        const findings = await readFile(join(reviewStore.directory, 'review.md'), 'utf8');
        invariant(sha256(findings) === submission.findingsHash, 'Review findings changed after submission', 'REVIEW_SESSION_STALE');
        const result = await this.submitArtifact(id, 'review', findings);
        item = result.item;
        await refreshCurrentSession(this, item, enforcement.store, 'validation');
        enforcement = await requireCurrentSession(this, item, ['validation']);
        const reviewer = `review-session:${reviewState.id}`;
        const review = { reviewer, outcome: submission.outcome, independent: true, humanReviewed: humanReviewer !== undefined, artifactSha256: item.artifacts.review.sha256, timestamp: submission.submittedAt, enforcement: enforcement.evidence, reviewSessionId: reviewState.id, findingsHash: submission.findingsHash, handoffHash: submission.handoffHash, confirmationHash: submission.confirmationHash, stale: false, ...(humanReviewer === undefined ? {} : { humanReviewer }) };
        enforcement.state.review = { snapshotHash: enforcement.evidence.snapshotHash, reviewer, reviewSessionId: reviewState.id, findingsHash: submission.findingsHash, handoffHash: submission.handoffHash, approved: review.outcome === 'APPROVED', humanReviewed: review.humanReviewed, confirmationHash: submission.confirmationHash };
        await enforcement.store.save(enforcement.state);
        item.review = review;
        await this.persist(item);
        await this.record(item, 'REVIEW_RECORDED', { reviewer: review.reviewer, outcome: review.outcome, independent: review.independent, humanReviewed: review.humanReviewed, session: enforcement.state.id, snapshotHash: enforcement.evidence.snapshotHash });
        await revokeSession(this, reviewStore, 'REVIEW_RECORDED');
        item = await this.status(id);
        invariant(item.review, 'Recorded review was lost during session revocation', 'WORK_ITEM_REVISION_CONFLICT');
        if (review.outcome === 'APPROVED') {
            const moved = await this.move(item, 'READY_FOR_REVIEW', governance);
            await refreshCurrentSession(this, moved, enforcement.store, 'validation');
            return moved;
        }
        item.validations.forEach((entry) => { entry.stale = true; });
        item.review.stale = true;
        item.review.staleReason = 'changes requested';
        const from = item.state;
        item.state = revisionTransition(item.state);
        await this.persist(item, governance);
        await this.record(item, 'REVISION_TRANSITION', { from, to: item.state, reviewSession: initialReviewState.id, reason: 'CHANGES_REQUESTED' });
        const revisionStore = await createSession(this, item.id, { seedStore: enforcement.store });
        const revised = await this.status(item.id);
        await this.record(revised, 'REVISION_SESSION_CREATED', { session: (await revisionStore.load()).id, epoch: revised.enforcementEpoch, previousSession: enforcement.state.id });
        return revised;
    }
    async complete(id, confirmation) {
        const item = await this.status(id);
        invariant(item.gateVersion === 1, 'Historical work must be revised under the v1 gates before completion', 'WORK_ITEM_GATE_VERSION');
        invariant(item.state === 'READY_FOR_REVIEW', 'Completion requires READY_FOR_REVIEW', 'STATE_REQUIREMENT');
        invariant(item.review?.outcome === 'APPROVED' && !item.review.stale, 'Approved current review is required', 'REVIEW_REQUIRED');
        const { archiveSession, requireCurrentSession, revokeSession } = await import('../enforcement/session.js');
        const enforcement = await requireCurrentSession(this, item, ['validation']);
        const handoff = await requireCurrentHandoff(enforcement.store, enforcement.state);
        invariant(enforcement.state.validation?.passed && enforcement.state.validation.snapshotHash === enforcement.evidence.snapshotHash, 'Completion requires current governed validation evidence', 'SESSION_VALIDATION_REQUIRED');
        invariant(item.review.enforcement?.sessionId === enforcement.state.id && item.review.enforcement.snapshotHash === enforcement.evidence.snapshotHash && item.review.enforcement.governanceHash === enforcement.state.governanceHash, 'Completion requires review of the current governed candidate', 'REVIEW_EVIDENCE_STALE');
        invariant(item.review.handoffHash === handoff.metadata.contentHash && enforcement.state.review?.handoffHash === handoff.metadata.contentHash, 'Completion requires review of the current implementation handoff', 'REVIEW_EVIDENCE_STALE');
        invariant(item.validations.some((entry) => !entry.stale && entry.outcome === 'PASS' && entry.enforcement?.sessionId === enforcement.state.id && entry.enforcement.snapshotHash === enforcement.evidence.snapshotHash), 'Completion requires session-bound passing validation', 'VALIDATION_EVIDENCE_STALE');
        const governance = await this.governance(item);
        for (const name of requiredCommandIds(governance))
            invariant(item.validations.some((entry) => !entry.stale && entry.outcome === 'PASS' && entry.name === name && entry.enforcement?.sessionId === enforcement.state.id && entry.enforcement.snapshotHash === enforcement.evidence.snapshotHash), `Required validation has not passed for the current candidate: ${name}`, 'VALIDATION_REQUIRED');
        if (item.selectedProfile !== 'LIGHTWEIGHT') {
            invariant(enforcement.state.promotion?.applied && enforcement.state.promotion.receiptHash, 'Reviewed candidate delivery is required before completion', 'PROMOTION_REQUIRED');
            const receipt = parseDeliveryReceipt(await readJson(join(this.repository.workItemDirectory(item.id), 'delivery-receipt.json')));
            invariant(hashObject(receipt) === enforcement.state.promotion.receiptHash && receipt.snapshotHash === enforcement.evidence.snapshotHash && receipt.sessionId === enforcement.state.id, 'Delivery receipt is missing or stale', 'DELIVERY_STALE');
        }
        else
            invariant(hashObject(await import('../enforcement/files.js').then(({ snapshot }) => snapshot(enforcement.state.hostRoot))) === enforcement.evidence.snapshotHash, 'Host checkout no longer matches the reviewed candidate', 'DELIVERY_STALE');
        const record = createConfirmation(confirmation, { workItemId: id, action: 'COMPLETE_WORK_ITEM', project: item.project, riskProfile: item.selectedProfile, timestamp: this.now() });
        item.confirmations.push(record);
        await this.record(item, 'HUMAN_CONFIRMED', { action: record.action, localOsUser: record.localOsUser, session: enforcement.state.id, snapshotHash: enforcement.evidence.snapshotHash });
        const completed = await this.move(item, 'COMPLETE');
        await revokeSession(this, enforcement.store, 'WORK_ITEM_COMPLETE');
        await archiveSession(this, enforcement.store);
        return this.status(completed.id);
    }
    async assessRisk(id, newInput) {
        const item = await this.status(id);
        invariant(item.state !== 'COMPLETE', 'Completed work cannot be reassessed', 'STATE_REQUIREMENT');
        const governance = await this.governance(item);
        const previous = item.risk.minimumProfile;
        const merged = { ...item.risk.input, ...newInput, affectedPaths: [...new Set([...(item.risk.input.affectedPaths ?? []), ...(newInput.affectedPaths ?? [])])], dependencyChanges: [...new Set([...(item.risk.input.dependencyChanges ?? []), ...(newInput.dependencyChanges ?? [])])], requestedCommands: [...new Set([...(item.risk.input.requestedCommands ?? []), ...(newInput.requestedCommands ?? [])])] };
        item.risk = classifyRisk(merged, governance);
        if (isHigherProfile(item.risk.minimumProfile, item.selectedProfile)) {
            const fromState = item.state;
            item.selectedProfile = item.risk.minimumProfile;
            const stale = invalidateApprovals(item.confirmations, ['ACCEPT_SPECIFICATION', 'APPROVE_ARCHITECTURE', 'APPROVE_PLAN'], 'risk escalation');
            item.validations.forEach((entry) => { entry.stale = true; });
            if (item.review) {
                item.review.stale = true;
                item.review.staleReason = 'risk escalation';
            }
            if (stateAtLeast(item.state, 'SPEC_ACCEPTED'))
                item.state = 'SPEC_DRAFT';
            await this.persist(item, governance);
            await this.record(item, 'RISK_ESCALATED', { previousMinimum: previous, newMinimum: item.risk.minimumProfile, previousState: fromState, revisitState: item.state, approvalsInvalidated: stale, reasons: item.risk.reasons.map((reason) => reason.code) });
            return item;
        }
        await this.persist(item, governance);
        await this.record(item, 'RISK_REEVALUATED', { previousMinimum: previous, newMinimum: item.risk.minimumProfile });
        return item;
    }
    async overrideRisk(id, requested, confirmation) {
        const item = await this.status(id);
        if (isHigherProfile(requested, item.selectedProfile)) {
            const previousState = item.state;
            item.selectedProfile = requested;
            const stale = invalidateApprovals(item.confirmations, ['ACCEPT_SPECIFICATION', 'APPROVE_ARCHITECTURE', 'APPROVE_PLAN'], 'human risk increase');
            item.validations.forEach((entry) => { entry.stale = true; });
            if (item.review) {
                item.review.stale = true;
                item.review.staleReason = 'risk increase';
            }
            if (stateAtLeast(item.state, 'SPEC_ACCEPTED') && item.state !== 'COMPLETE')
                item.state = 'SPEC_DRAFT';
            await this.persist(item);
            await this.record(item, 'RISK_INCREASED_BY_HUMAN', { profile: requested, previousState, revisitState: item.state, approvalsInvalidated: stale });
            return item;
        }
        invariant(isHigherProfile(item.risk.minimumProfile, requested) || isHigherProfile(item.selectedProfile, requested), 'Requested profile is not a reduction', 'RISK_OVERRIDE_REDUNDANT');
        assertDowngradeAllowed(item.risk, requested);
        invariant(confirmation, 'Risk reduction requires human confirmation', 'CONFIRMATION_REQUIRED');
        const record = createConfirmation(confirmation, { workItemId: id, action: 'OVERRIDE_RISK_DOWN', project: item.project, riskProfile: requested, timestamp: this.now(), reasonRequired: true });
        item.confirmations.push(record);
        if (isHigherProfile(item.risk.minimumProfile, requested))
            item.risk.minimumProfile = requested;
        item.selectedProfile = requested;
        await this.persist(item);
        await this.record(item, 'RISK_DOWNGRADED_HUMAN_CONFIRMED', { profile: requested, reason: record.reason, localOsUser: record.localOsUser });
        return item;
    }
    async verifyEvidence() { return this.evidence.verify(); }
}
//# sourceMappingURL=workflow.js.map