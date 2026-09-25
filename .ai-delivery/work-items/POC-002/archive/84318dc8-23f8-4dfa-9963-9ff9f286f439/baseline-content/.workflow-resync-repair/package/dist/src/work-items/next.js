import { join } from 'node:path';
import { SessionStore } from '../enforcement/session.js';
import { requireCurrentHandoff } from '../enforcement/bindings.js';
import { readJson } from '../shared/fs.js';
import { parseProviderPreparationReceipt } from '../schemas/validation.js';
async function activeState(path, item, role) {
    if (!path)
        return undefined;
    try {
        const store = new SessionStore(path);
        const state = await store.load();
        const valid = state.workItem === item.id && state.project === item.project && state.epoch === (item.enforcementEpoch ?? 0)
            && state.lifecycleState === item.state && (role === 'source' ? state.role === 'implementation' || state.role === 'validation' : state.role === 'review');
        if (!valid)
            return undefined;
        if (role === 'review')
            await requireCurrentHandoff(store, state);
        return { store, state };
    }
    catch {
        return undefined;
    }
}
async function preparedProvider(store, state) {
    try {
        const receipt = parseProviderPreparationReceipt(await readJson(join(store.directory, 'provider-preparation.json')));
        if (typeof receipt.provider === 'string' && receipt.sessionId === state.id && receipt.epoch === state.epoch)
            return receipt.provider;
    }
    catch { /* A missing or stale preparation retains the explicit placeholder. */ }
    return 'PROVIDER';
}
function imageArgument(state) { return state.mode === 'ISOLATED_ENVIRONMENT' ? ' --image IMAGE' : ''; }
async function resumeCommand(store, state) {
    return `ai-delivery session resume --session ${JSON.stringify(store.directory)} --provider ${await preparedProvider(store, state)}${imageArgument(state)}`;
}
export async function nextAction(item) {
    const id = item.id;
    const missing = [];
    let command;
    const source = await activeState(item.enforcementSession, item, 'source');
    switch (item.state) {
        case 'DISCOVERING':
            command = `ai-delivery discovery submit --id ${id} --file DISCOVERY.md`;
            break;
        case 'SPEC_DRAFT':
            command = item.artifacts.specification ? `ai-delivery spec accept --id ${id}` : `ai-delivery spec submit --id ${id} --file SPECIFICATION.md`;
            break;
        case 'SPEC_ACCEPTED':
            if (item.selectedProfile === 'HIGH_RISK' && !item.artifacts['architecture-impact'])
                command = `ai-delivery architecture submit --id ${id} --file ARCHITECTURE.md`;
            else if (item.selectedProfile === 'HIGH_RISK' && !item.confirmations.some((entry) => !entry.stale && entry.action === 'APPROVE_ARCHITECTURE'))
                command = `ai-delivery architecture approve --id ${id}`;
            else
                command = `ai-delivery plan submit --id ${id} --file PLAN.md`;
            break;
        case 'PLANNING':
            command = `ai-delivery plan approve --id ${id}`;
            break;
        case 'PLAN_APPROVED':
            command = `ai-delivery session start PROVIDER --root . --id ${id}`;
            break;
        case 'IMPLEMENTING': {
            if (!source)
                command = `ai-delivery session start PROVIDER --root . --id ${id}`;
            else {
                try {
                    await requireCurrentHandoff(source.store, source.state);
                    command = `ai-delivery validation run --session ${JSON.stringify(source.store.directory)}`;
                }
                catch {
                    missing.push('candidate-bound implementation handoff');
                    command = await resumeCommand(source.store, source.state);
                }
            }
            break;
        }
        case 'VALIDATING': {
            if (!source)
                command = null;
            else if (!item.validations.some((entry) => !entry.stale && entry.name === 'diff' && entry.outcome === 'PASS'))
                command = `ai-delivery validation run --session ${JSON.stringify(source.store.directory)}`;
            else {
                const review = await activeState(item.reviewSession, item, 'review');
                if (review && review.state.reviewOf === source.state.id)
                    command = review.state.reviewSubmission
                        ? `ai-delivery review record --session ${JSON.stringify(source.store.directory)} --review-session ${JSON.stringify(review.store.directory)}`
                        : await resumeCommand(review.store, review.state);
                else
                    command = `ai-delivery session review --session ${JSON.stringify(source.store.directory)} --provider ${await preparedProvider(source.store, source.state)}${imageArgument(source.state)}`;
            }
            break;
        }
        case 'READY_FOR_REVIEW': {
            let delivered = item.selectedProfile === 'LIGHTWEIGHT';
            if (item.enforcementSession)
                try {
                    delivered ||= (await new SessionStore(item.enforcementSession).load()).promotion?.applied === true;
                }
                catch { /* Report replacement below. */ }
            command = item.enforcementSession ? delivered ? `ai-delivery complete --id ${id}` : `ai-delivery promotion apply --session ${JSON.stringify(item.enforcementSession)}` : null;
            break;
        }
        case 'COMPLETE':
            command = null;
            break;
    }
    if (!source && ['IMPLEMENTING', 'VALIDATING', 'READY_FOR_REVIEW'].includes(item.state))
        missing.push('active governed session');
    if (item.state === 'VALIDATING' && !item.validations.some((entry) => !entry.stale && entry.name === 'diff' && entry.outcome === 'PASS'))
        missing.push('authoritative validation');
    if (item.state === 'VALIDATING' && !item.review)
        missing.push('independent review');
    return { state: item.state, missing, command };
}
//# sourceMappingURL=next.js.map