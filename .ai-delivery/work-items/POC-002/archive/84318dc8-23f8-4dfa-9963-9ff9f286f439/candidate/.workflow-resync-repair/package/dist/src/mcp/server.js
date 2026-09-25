import { join } from 'node:path';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { writeTextAtomic } from '../shared/fs.js';
import { runGovernedCommand } from '../enforcement/containers.js';
import { checkDrift } from '../enforcement/session.js';
import { snapshot } from '../enforcement/files.js';
import { PACKAGE_VERSION } from '../config/versions.js';
import { requireCurrentHandoff, reviewConfirmationHash } from '../enforcement/bindings.js';
const catalog = [
    { name: 'status', description: 'Work item, project, lifecycle, risk, approvals, capability manifest and stale state', fields: {} },
    { name: 'file_list', description: 'List only readable approved paths', fields: {} },
    { name: 'file_search', description: 'Literal search of approved files', fields: { query: 'string' } },
    { name: 'file_read', description: 'Read approved UTF-8 file and SHA-256', fields: { path: 'string' } },
    { name: 'git_status', description: 'Scope-filtered workspace changes against session baseline, including new and deleted files', fields: {} },
    { name: 'git_diff', description: 'Unified baseline-to-candidate diff with bound SHA-256 values', fields: {} },
    { name: 'changed_paths', description: 'Inspect governed changed paths', fields: {} },
    { name: 'discovery_submit', description: 'Submit discovery via canonical lifecycle', fields: { content: 'string' } },
    { name: 'specification_submit', description: 'Submit specification; does not human-accept it', fields: { content: 'string' } },
    { name: 'plan_submit', description: 'Submit plan; does not human-approve it', fields: { content: 'string' } },
    { name: 'handoff_submit', description: 'Persist a candidate-bound implementation handoff for validation and independent review', fields: { content: 'string' } },
    { name: 'review_submit', description: 'Submit review findings and decision from an independent governed review session', fields: { content: 'string', outcome: 'reviewOutcome' } },
    { name: 'file_create', description: 'Atomic create in approved implementation scope', fields: { path: 'string', expectedSha256: 'nullableHash', content: 'string' } },
    { name: 'file_replace', description: 'Atomic optimistic replacement', fields: { path: 'string', expectedSha256: 'string', content: 'string' } },
    { name: 'file_delete', description: 'Optimistic controlled delete', fields: { path: 'string', expectedSha256: 'string' } },
    { name: 'command_run', description: 'Run fixed command ID in a controlled container; no caller arguments', fields: { id: 'string' } },
    { name: 'scope_validate', description: 'Validate all candidate paths and current baseline', fields: {} },
    { name: 'evidence_validate', description: 'Verify evidence hash chain', fields: {} },
    { name: 'final_diff_validate', description: 'Validate candidate scope, freshness and drift', fields: {} },
];
export class DeliveryMcpServer {
    gateway;
    constructor(gateway) {
        this.gateway = gateway;
    }
    async tools() {
        const state = await this.gateway.current();
        const manifest = state.manifest;
        const names = new Set(['status', 'evidence_validate']);
        if (manifest.filesystem.read.length)
            ['file_list', 'file_search', 'file_read', ...((state.role === 'implementation' || state.role === 'validation') ? ['scope_validate', 'final_diff_validate'] : [])].forEach((name) => names.add(name));
        if (manifest.git.inspect)
            ['git_status', 'git_diff', 'changed_paths'].forEach((name) => names.add(name));
        if (manifest.stage === 'DISCOVERING')
            names.add('discovery_submit');
        if (manifest.stage === 'SPEC_DRAFT')
            names.add('specification_submit');
        if (manifest.stage === 'SPEC_ACCEPTED' || manifest.stage === 'PLANNING')
            names.add('plan_submit');
        if (state.role === 'implementation' && manifest.stage === 'IMPLEMENTING') {
            if (manifest.filesystem.write.length) {
                names.add('file_create');
                names.add('file_replace');
            }
            if (manifest.filesystem.delete.length)
                names.add('file_delete');
            names.add('handoff_submit');
        }
        if (state.role === 'review' && manifest.stage === 'VALIDATING')
            names.add('review_submit');
        if ((state.role === 'implementation' || state.role === 'validation') && manifest.terminal.available && manifest.terminal.fixedCommands.length)
            names.add('command_run');
        return catalog.filter((tool) => names.has(tool.name) && manifest.mcp.allowedServers.includes('ai-delivery') && manifest.mcp.allowedOperations.includes(tool.name)).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: { type: 'object', properties: Object.fromEntries(Object.entries(tool.fields).map(([name, type]) => [name, type === 'nullableHash' ? { type: ['string', 'null'] } : type === 'reviewOutcome' ? { type: 'string', enum: ['APPROVED', 'CHANGES_REQUESTED'] } : { type: 'string', maxLength: name === 'content' ? 2097152 : 4096 }])), required: Object.keys(tool.fields), additionalProperties: false } }));
    }
    async call(name, raw) {
        const advertised = await this.tools();
        invariant(advertised.some((tool) => tool.name === name), 'Operation not authorized for this session', 'POLICY_DENIED');
        const tool = catalog.find((entry) => entry.name === name);
        invariant(typeof raw === 'object' && raw !== null && !Array.isArray(raw), 'Tool arguments must be an object', 'SCHEMA_INVALID');
        const input = raw;
        invariant(Object.keys(input).length === Object.keys(tool.fields).length && Object.entries(tool.fields).every(([key, type]) => (type === 'nullableHash' && input[key] === null) || (type === 'reviewOutcome' ? input[key] === 'APPROVED' || input[key] === 'CHANGES_REQUESTED' : typeof input[key] === 'string' && String(input[key]).length <= (key === 'content' ? 2097152 : 4096))), 'Unexpected, missing or invalid tool arguments', 'SCHEMA_INVALID');
        await this.gateway.authorize('mcp.invoke');
        const state = await this.gateway.current();
        if (name === 'status') {
            const item = await this.gateway.workflow.status(state.workItem);
            return { workItem: item.id, project: item.project, lifecycle: item.state, riskProfile: item.selectedProfile, capabilities: state.manifest, approvals: item.confirmations, suspension: item.suspension ?? { active: false }, stale: false };
        }
        if (name === 'file_list')
            return this.gateway.list();
        if (name === 'file_read')
            return this.gateway.read(input.path);
        if (name === 'file_search')
            return this.gateway.search(input.query);
        if (['git_status', 'git_diff', 'changed_paths'].includes(name))
            return this.gateway.inspectChanges();
        if (name === 'evidence_validate') {
            await this.gateway.authorize('validation.execute');
            return this.gateway.workflow.verifyEvidence();
        }
        if (name === 'scope_validate' || name === 'final_diff_validate')
            return this.gateway.validate();
        if (name === 'command_run')
            return runGovernedCommand(this.gateway, input);
        if (name.startsWith('file_')) {
            await this.gateway.mutate(name.slice(5), input.path, input.expectedSha256, input.content);
            return { applied: true };
        }
        await this.gateway.authorize('workflow.submit');
        await checkDrift(this.gateway.workflow, this.gateway.store, state);
        const content = input.content;
        invariant(content.trim().length > 0, 'Empty submission', 'SCHEMA_INVALID');
        if (name === 'discovery_submit')
            await this.gateway.workflow.submitDiscovery(state.workItem, content);
        else if (name === 'specification_submit')
            await this.gateway.workflow.submitSpecification(state.workItem, content);
        else if (name === 'plan_submit')
            await this.gateway.workflow.submitPlan(state.workItem, content);
        else if (name === 'review_submit') {
            invariant(state.role === 'review' && state.reviewOf, 'Independent review session required', 'REVIEW_SESSION_REQUIRED');
            const handoff = await requireCurrentHandoff(this.gateway.store, state);
            const current = await snapshot(state.workspace);
            const snapshotHash = hashObject(current);
            const findingsHash = sha256(content);
            const handoffHash = handoff.metadata.contentHash;
            const outcome = input.outcome;
            const submittedAt = new Date().toISOString();
            const confirmationHash = reviewConfirmationHash(state.id, { sourceSession: state.reviewOf, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash, findingsHash, handoffHash, outcome });
            await writeTextAtomic(join(this.gateway.store.directory, 'review.md'), content);
            state.reviewSubmission = { sourceSession: state.reviewOf, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash, findingsHash, handoffHash, outcome, submittedAt, confirmationHash };
            await this.gateway.store.save(state);
            await this.gateway.audit('REVIEW_FINDINGS_SUBMITTED', { sourceSession: state.reviewOf, reviewSession: state.id, snapshotHash, governanceHash: state.governanceHash, manifestHash: state.manifestHash, findingsHash, handoffHash, outcome, confirmationHash });
            return { recorded: true, outcome, findingsHash, snapshotHash, confirmationHash, humanAcceptanceRequired: state.manifest.riskProfile === 'HIGH_RISK' };
        }
        else
            return this.gateway.submitHandoff(content);
        // Advance only this known gateway submission; unrelated CLI/governance changes still stale the session.
        const item = await this.gateway.workflow.status(state.workItem);
        state.manifest = await this.gateway.workflow.capabilities(state.workItem);
        state.manifestHash = item.capabilityManifestHash;
        state.artifactsHash = hashObject(item.artifacts);
        await this.gateway.store.save(state);
        return { submitted: true, lifecycle: item.state };
    }
    async request(raw) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
        const request = raw;
        const id = request.id;
        if (id === undefined && typeof request.method === 'string' && request.method.startsWith('notifications/'))
            return;
        if (request.jsonrpc !== '2.0' || (typeof id !== 'string' && typeof id !== 'number') || typeof request.method !== 'string')
            return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
        try {
            let result;
            if (request.method === 'initialize')
                result = { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'ai-delivery', version: PACKAGE_VERSION } };
            else if (request.method === 'ping')
                result = {};
            else if (request.method === 'tools/list')
                result = { tools: await this.tools() };
            else if (request.method === 'tools/call') {
                const params = request.params;
                invariant(typeof params?.name === 'string', 'Tool name required', 'SCHEMA_INVALID');
                try {
                    const value = await this.call(params.name, params.arguments ?? {});
                    result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
                }
                catch (error) {
                    result = { content: [{ type: 'text', text: error.code ?? 'POLICY_DENIED' }], isError: true };
                }
            }
            else
                return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
            return { jsonrpc: '2.0', id, result };
        }
        catch (error) {
            return { jsonrpc: '2.0', id, error: { code: -32000, message: error.code ?? 'POLICY_DENIED' } };
        }
    }
    async serve(input, output) {
        let buffer = '';
        let previousTools = '';
        for await (const chunk of input) {
            buffer += String(chunk);
            invariant(Buffer.byteLength(buffer) <= 3 * 1024 * 1024, 'MCP frame too large', 'MCP_FRAME_LIMIT');
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                if (!line.trim())
                    continue;
                let response;
                try {
                    response = await this.request(JSON.parse(line));
                }
                catch {
                    response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
                }
                if (response)
                    output.write(`${JSON.stringify(response)}\n`);
                let tools = '';
                try {
                    tools = hashObject(await this.tools());
                }
                catch { /* Invalidated sessions advertise no subsequent tools. */ }
                if (previousTools && previousTools !== tools)
                    output.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })}\n`);
                previousTools = tools;
            }
        }
    }
}
//# sourceMappingURL=server.js.map
