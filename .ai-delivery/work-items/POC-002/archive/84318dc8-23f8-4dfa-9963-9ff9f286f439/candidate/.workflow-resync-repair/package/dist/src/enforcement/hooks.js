import { coreAllows } from './policy.js';
import { isAbsolute, relative } from 'node:path';
import { safePath, within } from './files.js';
import { checkDrift } from './session.js';
/** Unknown representations fail closed. Native writes/shell cannot bypass optimistic writes or command isolation. */
export async function preToolUse(gateway, raw) {
    try {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return { decision: 'DENY', reason: 'MALFORMED_HOOK' };
        const event = raw;
        if (typeof event.tool_name !== 'string' || typeof event.tool_input !== 'object' || event.tool_input === null || Array.isArray(event.tool_input))
            return { decision: 'DENY', reason: 'MALFORMED_HOOK' };
        const input = event.tool_input;
        const tool = event.tool_name;
        if (['readFile', 'read_file', 'Read'].includes(tool)) {
            const rawPath = input.file_path ?? input.path ?? input.filePath;
            if (typeof rawPath !== 'string')
                return { decision: 'DENY', reason: 'MALFORMED_PATH' };
            let path = rawPath;
            const state = await gateway.current();
            if (isAbsolute(path)) {
                if (!within(state.workspace, path))
                    return { decision: 'DENY', reason: 'PATH_ESCAPE' };
                path = relative(state.workspace, path).replace(/\\/g, '/');
            }
            await safePath(state.workspace, path);
            const policyInput = await gateway.input('file.read', { path });
            if (!coreAllows(policyInput))
                return { decision: 'DENY', reason: 'CORE_DENY' };
            const decision = await gateway.policy.decide(policyInput);
            return decision.decision === 'ALLOW' && policyInput.confirmationRequired ? { decision: 'ASK', reason: 'HUMAN_CONFIRMATION_REQUIRED' } : decision;
        }
        if (tool.startsWith('mcp__ai-delivery__') || tool.startsWith('mcp_ai-delivery_')) {
            // The MCP server repeats operation-specific policy and schema checks before doing any work.
            return gateway.policy.decide(await gateway.input('mcp.invoke'));
        }
        return { decision: 'DENY', reason: 'NATIVE_OR_UNKNOWN_TOOL_USE_GOVERNED_MCP' };
    }
    catch {
        return { decision: 'DENY', reason: 'POLICY_UNAVAILABLE_OR_INVALID' };
    }
}
/** Revalidate signed state and drift after every provider tool call. */
export async function postToolUse(gateway, raw) {
    try {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return { decision: 'DENY', reason: 'MALFORMED_HOOK' };
        const state = await gateway.current();
        await checkDrift(gateway.workflow, gateway.store, state);
        await gateway.workflow.verifyEvidence();
        await gateway.audit('POST_TOOL_USE_VERIFIED', { providerTool: typeof raw.tool_name === 'string' ? raw.tool_name : 'unknown' });
        return { decision: 'ALLOW', reason: 'STATE_AND_DRIFT_VERIFIED' };
    }
    catch {
        return { decision: 'DENY', reason: 'POLICY_UNAVAILABLE_OR_INVALID' };
    }
}
export function hookOutput(decision, event = 'PreToolUse') {
    return { hookSpecificOutput: { hookEventName: event, permissionDecision: decision.decision.toLowerCase(), permissionDecisionReason: decision.reason } };
}
//# sourceMappingURL=hooks.js.map