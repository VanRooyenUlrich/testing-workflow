import { hashObject } from '../shared/hash.js';
import { parseCapabilityManifest } from '../schemas/validation.js';
const submissionPath = { SPEC_DRAFT: 'specification.md', PLANNING: 'plan.md', READY_FOR_REVIEW: 'review.md' };
export function calculateCapabilities(input) {
    const { workItem, project, stage, riskProfile, governance } = input;
    const implementation = stage === 'IMPLEMENTING';
    const validating = stage === 'VALIDATING';
    const submission = submissionPath[stage];
    const highRisk = riskProfile === 'HIGH_RISK';
    const lightweight = riskProfile === 'LIGHTWEIGHT';
    const mutationForbidden = stage === 'COMPLETE' || stage === 'DISCOVERING' || stage === 'SPEC_ACCEPTED' || stage === 'PLAN_APPROVED';
    const write = implementation ? [...governance.allowedPaths] : submission ? [`.ai-delivery/work-items/${workItem}/${submission}`] : [];
    const operations = ['status', 'evidence_validate'];
    if (stage !== 'COMPLETE')
        operations.push('file_list', 'file_search', 'file_read', 'git_status', 'git_diff', 'changed_paths', 'scope_validate', 'final_diff_validate');
    if (stage === 'DISCOVERING')
        operations.push('discovery_submit');
    if (stage === 'SPEC_DRAFT')
        operations.push('specification_submit');
    if (stage === 'SPEC_ACCEPTED' || stage === 'PLANNING')
        operations.push('plan_submit');
    if (implementation)
        operations.push('file_create', 'file_replace', 'handoff_submit');
    if (implementation && lightweight)
        operations.push('file_delete');
    if ((implementation || validating) && Object.keys(governance.commands).length)
        operations.push('command_run');
    if (validating || stage === 'READY_FOR_REVIEW')
        operations.push('review_submit');
    return parseCapabilityManifest({
        workItem, project, stage, riskProfile,
        filesystem: { read: stage === 'COMPLETE' ? [] : [...governance.allowedPaths], write: mutationForbidden ? [] : write, delete: implementation && lightweight ? [...governance.allowedPaths] : [] },
        terminal: { available: implementation || validating, arbitraryCommands: false, fixedCommands: implementation || validating ? Object.keys(governance.commands).sort() : [] },
        git: { inspect: stage !== 'COMPLETE', mutate: false },
        mcp: { allowedServers: [...new Set(['ai-delivery', ...(highRisk ? [] : governance.capabilities.allowedMcpServers)])].sort(), allowedOperations: [...new Set([...operations, ...(highRisk ? [] : governance.capabilities.allowedMcpOperations)])].sort() },
        network: { enabled: lightweight && governance.capabilities.lightweightNetworkDomains.length > 0, allowedDomains: lightweight ? [...governance.capabilities.lightweightNetworkDomains].sort() : [] },
        credentials: { hostCredentialsAvailable: false },
        workspace: { isolationMode: lightweight ? 'HOST_WORKSPACE' : highRisk ? 'ISOLATED_ENVIRONMENT' : 'ISOLATED_WORKTREE' },
        promotion: { required: input.riskProfile !== 'LIGHTWEIGHT' },
    });
}
export function capabilityManifestHash(manifest) { return hashObject(parseCapabilityManifest(manifest)); }
//# sourceMappingURL=capabilities.js.map