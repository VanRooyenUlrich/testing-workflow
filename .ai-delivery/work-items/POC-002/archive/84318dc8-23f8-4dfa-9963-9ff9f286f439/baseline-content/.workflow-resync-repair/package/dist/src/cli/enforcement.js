import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { invariant } from '../shared/errors.js';
import { flag, booleanFlag } from './arguments.js';
import { Workflow } from '../work-items/workflow.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { PolicyGateway } from '../enforcement/gateway.js';
import { OpaPolicy } from '../enforcement/policy.js';
import { SessionStore, createSession, resynchronize, revokeSession } from '../enforcement/session.js';
import { DeliveryMcpServer } from '../mcp/server.js';
import { ProviderAdapter, providers, withSessionLaunchLock } from '../providers/adapters.js';
import { preToolUse, postToolUse, hookOutput } from '../enforcement/hooks.js';
import { PatchPromotion } from '../enforcement/promotion.js';
import { runGovernedCommand } from '../enforcement/containers.js';
import { startOpa, statusOpa, stopOpa } from '../enforcement/opa-runtime.js';
import { contextBundle } from '../enforcement/context.js';
import { IsolatedEnvironment } from '../enforcement/environment.js';
import { createReviewSession } from '../enforcement/review.js';
import { sha256 } from '../shared/hash.js';
import { applyPrune, inspectPrune } from '../enforcement/prune.js';
import { runReferenceClient } from '../mcp/reference-client.js';
import { requirePinnedImage } from '../shared/images.js';
const output = (value) => { stdout.write(`${JSON.stringify(value, null, 2)}\n`); };
async function launchSessionProvider(workflow, store, provider, prepareOnly, image, includeContext) {
    const state = await store.load();
    const gateway = new PolicyGateway(workflow, store, new OpaPolicy());
    await gateway.current();
    if (state.mode === 'ISOLATED_ENVIRONMENT')
        requirePinnedImage(image ?? '');
    const adapter = new ProviderAdapter(provider);
    const prepared = await adapter.prepareSession(state, store.directory, resolve(process.argv[1]));
    await adapter.validateConfiguration(prepared);
    output({ session: store.directory, role: state.role, epoch: state.epoch, expiresAt: state.expiresAt, isolation: state.mode, ...(includeContext === undefined ? {} : { context: includeContext }), configuration: prepared });
    if (prepareOnly)
        return;
    await withSessionLaunchLock(store.directory, async () => {
        const current = await gateway.current();
        const launchPrepared = await adapter.prepareSession(current, store.directory, resolve(process.argv[1]));
        await adapter.validateConfiguration(launchPrepared);
        if (current.mode === 'ISOLATED_ENVIRONMENT')
            output(await new IsolatedEnvironment().launch(gateway, provider, image));
        else
            process.exitCode = await adapter.launch(launchPrepared);
    });
}
export async function enforcementCommand(args, confirm) {
    const [group, action, providerName] = args.positionals;
    if (!['session', 'mcp', 'hook', 'promotion', 'policy', 'command', 'context', 'grant', 'validation', 'review'].includes(group ?? ''))
        return false;
    if (group === 'policy' && action === 'start') {
        output({ container: await startOpa() });
        return true;
    }
    if (group === 'policy' && action === 'status') {
        output(await statusOpa());
        return true;
    }
    if (group === 'policy' && action === 'stop') {
        output({ stopped: await stopOpa() });
        return true;
    }
    if (group === 'session' && action === 'prune') {
        const root = resolve(flag(args, 'root', true));
        const plan = await inspectPrune(root);
        if (booleanFlag(args, 'dry-run'))
            output(plan);
        else if (booleanFlag(args, 'apply')) {
            output(plan);
            const accepted = await confirm('Remove only these closed, delivered session workspaces?', plan.planHash);
            output(await applyPrune(root, accepted.presentedArtifactSha256));
        }
        else
            invariant(false, 'Use session prune --dry-run or --apply', 'CLI_ARGUMENT_REQUIRED');
        return true;
    }
    if (group === 'session' && action === 'start') {
        invariant(providers.includes(providerName), 'Provider must be codex, claude, copilot or generic-mcp', 'PROVIDER_UNKNOWN');
        const workflow = new Workflow(new WorkflowRepository(resolve(flag(args, 'root', true))));
        const store = await createSession(workflow, flag(args, 'id', true));
        const state = await store.load();
        const pending = await workflow.status(flag(args, 'id', true));
        if (pending.state === 'PLAN_APPROVED')
            await workflow.beginImplementation(pending.id);
        void state;
        await launchSessionProvider(workflow, store, providerName, booleanFlag(args, 'prepare-only'), flag(args, 'image'));
        return true;
    }
    const store = new SessionStore(resolve(flag(args, 'session', true)));
    if (group === 'mcp' && action === 'reference-client') {
        const name = flag(args, 'call');
        const raw = flag(args, 'arguments');
        let call;
        if (name) {
            const parsed = raw ? JSON.parse(raw) : {};
            invariant(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), '--arguments must be a JSON object', 'CLI_ARGUMENT_INVALID');
            call = { name, arguments: parsed };
        }
        output(await runReferenceClient(resolve(process.argv[1]), store.directory, { ...(call === undefined ? {} : { call }), reconnect: booleanFlag(args, 'reconnect') }));
        return true;
    }
    if (group === 'command' && action === 'logs') {
        const state = await store.read();
        const command = flag(args, 'command', true);
        const attempts = state.validation?.commandResults?.filter((entry) => entry.command === command) ?? [];
        const result = [];
        for (const receipt of attempts) {
            const content = await readFile(resolve(store.directory, receipt.logPath), 'utf8');
            invariant(sha256(content) === receipt.logHash, 'Command log content hash mismatch', 'COMMAND_LOG_STALE');
            result.push({ receipt, content });
        }
        output({ command, attempts: result });
        return true;
    }
    if (group === 'session' && action === 'resync') {
        const state = await store.read();
        const workflow = new Workflow(new WorkflowRepository(state.repository));
        await resynchronize(workflow, store, await confirm('Close this session and invalidate validation after investigating host drift?', undefined, flag(args, 'reason', true)));
        output({ resynchronized: true, newSessionRequired: true });
        return true;
    }
    const state = await store.load();
    const workflow = new Workflow(new WorkflowRepository(state.repository));
    const gateway = new PolicyGateway(workflow, store, new OpaPolicy());
    if (group === 'mcp' && action === 'serve')
        await new DeliveryMcpServer(gateway).serve(stdin, stdout);
    else if (group === 'hook' && action === 'pre') {
        let text = '';
        try {
            for await (const chunk of stdin) {
                text += String(chunk);
                invariant(text.length <= 1048576, 'Hook input too large', 'HOOK_LIMIT');
            }
            output(hookOutput(await preToolUse(gateway, JSON.parse(text))));
        }
        catch {
            output(hookOutput({ decision: 'DENY', reason: 'MALFORMED_HOOK' }));
        }
    }
    else if (group === 'hook' && action === 'post') {
        let text = '';
        try {
            for await (const chunk of stdin) {
                text += String(chunk);
                invariant(text.length <= 1048576, 'Hook input too large', 'HOOK_LIMIT');
            }
            output(hookOutput(await postToolUse(gateway, JSON.parse(text)), 'PostToolUse'));
        }
        catch {
            output(hookOutput({ decision: 'DENY', reason: 'MALFORMED_HOOK' }, 'PostToolUse'));
        }
    }
    else if (group === 'session' && action === 'status')
        output({ ...state, current: await gateway.current() });
    else if (group === 'session' && action === 'close') {
        await revokeSession(workflow, store, 'USER_CLOSED');
        output({ closed: true, revoked: true });
    }
    else if (group === 'session' && action === 'review') {
        const source = await gateway.current();
        const requested = flag(args, 'provider');
        if (requested) {
            invariant(providers.includes(requested), 'Provider must be codex, claude, copilot or generic-mcp', 'PROVIDER_UNKNOWN');
            if (source.mode === 'ISOLATED_ENVIRONMENT')
                requirePinnedImage(flag(args, 'image') ?? '');
            const capability = await new ProviderAdapter(requested).inspectCapabilities();
            const readiness = ProviderAdapter.readiness(requested, capability);
            invariant(readiness.status !== 'FAIL', readiness.message, 'PROVIDER_CONTROLS_UNAVAILABLE');
        }
        const review = await createReviewSession(workflow, store);
        const context = await contextBundle(new PolicyGateway(workflow, review, new OpaPolicy()), 'review');
        if (requested) {
            await launchSessionProvider(workflow, review, requested, booleanFlag(args, 'prepare-only'), flag(args, 'image'), context);
        }
        else {
            const reviewState = await review.load();
            output({ session: review.directory, role: reviewState.role, epoch: reviewState.epoch, expiresAt: reviewState.expiresAt, context });
        }
    }
    else if (group === 'session' && (action === 'launch' || action === 'resume')) {
        const requested = providerName ?? flag(args, 'provider', true);
        invariant(providers.includes(requested), 'Provider must be codex, claude, copilot or generic-mcp', 'PROVIDER_UNKNOWN');
        await launchSessionProvider(workflow, store, requested, booleanFlag(args, 'prepare-only'), flag(args, 'image'));
    }
    else if (group === 'command' && action === 'run')
        output(await runGovernedCommand(gateway, { id: flag(args, 'command', true) }));
    else if (group === 'validation' && action === 'run')
        output(await gateway.validate());
    else if (group === 'review' && action === 'record') {
        const reviewStore = new SessionStore(resolve(flag(args, 'review-session', true)));
        const reviewState = await reviewStore.load();
        const submission = reviewState.reviewSubmission;
        invariant(submission, 'The review session has not submitted findings', 'REVIEW_SUBMISSION_REQUIRED');
        const item = await workflow.status(state.workItem);
        const confirmation = item.selectedProfile === 'HIGH_RISK' ? await confirm('Accept this governed review decision for the exact candidate?', submission.confirmationHash) : undefined;
        output(await workflow.recordReview(state.workItem, reviewStore.directory, confirmation));
    }
    else if (group === 'context' && (action === 'implementation' || action === 'review'))
        output(await contextBundle(gateway, action));
    else if (group === 'promotion') {
        const promotion = new PatchPromotion(gateway);
        if (action === 'preview')
            output(await promotion.preview());
        else if (action === 'apply') {
            const summary = await promotion.preview();
            output(summary);
            output(await promotion.apply(await confirm('Apply this reviewed candidate to the real checkout?', summary.confirmationHash)));
        }
        else
            invariant(false, 'Unknown promotion operation', 'CLI_COMMAND_UNKNOWN');
    }
    else if (group === 'grant' && action === 'confidential') {
        const path = flag(args, 'path', true);
        const expiresAt = flag(args, 'expires', true);
        const reason = flag(args, 'reason', true);
        const { normalizePath, mandatoryRestricted } = await import('../enforcement/files.js');
        normalizePath(path);
        invariant(!mandatoryRestricted(path) && Date.parse(expiresAt) > Date.now() && Date.parse(expiresAt) <= Date.now() + 3600000, 'Nonrestricted path and expiry within one hour required', 'GRANT_INVALID');
        const confirmation = await confirm(`Grant Confidential access for ${state.workItem}: ${path}, expires ${expiresAt}?`, undefined, reason);
        state.grants.push({ path, expiresAt, reason, actor: confirmation.localOsUser });
        await store.save(state);
        await gateway.audit('CONFIDENTIAL_GRANT', { path, expiresAt, reason, actor: confirmation.localOsUser });
        output({ granted: true });
    }
    else if (group === 'session' && action === 'validate')
        output(await gateway.validate());
    else if (group === 'session' && action === 'inspect-config')
        output(JSON.parse(await readFile(flag(args, 'file', true), 'utf8')));
    else
        invariant(false, 'Unknown enforcement command', 'CLI_COMMAND_UNKNOWN');
    return true;
}
//# sourceMappingURL=enforcement.js.map
