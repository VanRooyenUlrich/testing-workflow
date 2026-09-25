import { invariant } from '../shared/errors.js';
export const policyActions = ['file.read', 'file.write', 'file.delete', 'command.execute', 'network.access', 'mcp.invoke', 'tool.invoke', 'governance.change', 'promotion.apply', 'workflow.submit', 'validation.execute'];
export function validPolicyInput(input) {
    return input.schemaVersion === 1 && policyActions.includes(input.action)
        && ['workItem', 'project', 'stage', 'riskProfile', 'governanceHash', 'manifestHash'].every((key) => typeof input[key] === 'string' && String(input[key]).length > 0)
        && ['fresh', 'suspended', 'coreAllow', 'projectAllow', 'workItemAllow', 'stageAllow', 'riskAllow', 'confirmationRequired'].every((key) => typeof input[key] === 'boolean');
}
export function coreAllows(input) {
    return validPolicyInput(input) && input.fresh && !input.suspended && input.coreAllow && input.projectAllow && input.workItemAllow && input.stageAllow && input.riskAllow;
}
/** Only the trusted launcher supplies this endpoint; model input never selects policy or URLs. */
export class OpaPolicy {
    endpoint;
    transport;
    constructor(endpoint = 'http://127.0.0.1:8181', transport = fetch) {
        this.endpoint = endpoint;
        this.transport = transport;
        const url = new URL(endpoint);
        invariant(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/', 'OPA must use a trusted local endpoint', 'POLICY_ENDPOINT_INVALID');
    }
    async decide(input) {
        if (!coreAllows(input))
            return { decision: 'DENY', reason: 'CORE_DENY' };
        try {
            const response = await this.transport(`${this.endpoint.replace(/\/$/, '')}/v1/data/ai_delivery/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }), signal: AbortSignal.timeout(3000), redirect: 'error' });
            if (!response.ok)
                return { decision: 'DENY', reason: 'OPA_ERROR' };
            const body = await response.json();
            if (typeof body.result !== 'object' || body.result === null)
                return { decision: 'DENY', reason: 'OPA_UNDEFINED' };
            const result = body.result;
            if (!['ALLOW', 'DENY', 'ASK'].includes(result.decision ?? '') || typeof result.reason !== 'string')
                return { decision: 'DENY', reason: 'OPA_SCHEMA_INVALID' };
            if (result.decision === 'ALLOW' && input.confirmationRequired)
                return { decision: 'ASK', reason: 'HUMAN_CONFIRMATION_REQUIRED' };
            return result;
        }
        catch {
            return { decision: 'DENY', reason: 'OPA_UNAVAILABLE' };
        }
    }
}
export async function requirePolicy(engine, input) {
    // Defense in depth: an application policy or a faulty engine cannot reverse a core deny.
    invariant(coreAllows(input), 'Core policy denied operation', 'POLICY_DENIED');
    const decision = await engine.decide(input);
    invariant(decision.decision === 'ALLOW' && !input.confirmationRequired, decision.reason, 'POLICY_DENIED');
}
//# sourceMappingURL=policy.js.map