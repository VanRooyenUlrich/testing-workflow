import { hashObject } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { requireCurrentHandoff } from './bindings.js';
/** Deliberately constructs a new bundle; no transcript path or conversation is accepted. */
export async function contextBundle(gateway, kind) {
    const state = await gateway.current();
    const item = await gateway.workflow.status(state.workItem);
    const artifacts = {};
    for (const type of ['specification', 'plan', 'architecture-impact']) {
        if (item.artifacts[type])
            artifacts[type] = await gateway.workflow.repository.readArtifact(item.id, type);
    }
    invariant(artifacts.specification && artifacts.plan, 'Accepted specification and approved plan required', 'CONTEXT_INCOMPLETE');
    const handoff = kind === 'review' ? await requireCurrentHandoff(gateway.store, state) : undefined;
    return { boundary: kind, workItem: item.id, project: item.project, artifacts, governanceHash: state.governanceHash, capabilities: state.manifest, readOnly: kind === 'review', ...(handoff ? { handoff: { content: handoff.content, ...handoff.metadata } } : {}), ...(kind === 'review' ? { finalDiff: await gateway.inspectChanges(), validation: state.validation ?? null } : {}), artifactHash: hashObject(artifacts) };
}
//# sourceMappingURL=context.js.map