import { invariant } from '../shared/errors.js';
import { globMatches } from '../shared/glob.js';
const rank = { LIGHTWEIGHT: 0, STANDARD: 1, HIGH_RISK: 2 };
export function maximumProfile(...profiles) { return profiles.reduce((highest, current) => rank[current] > rank[highest] ? current : highest, 'LIGHTWEIGHT'); }
export function isHigherProfile(candidate, current) { return rank[candidate] > rank[current]; }
function lightweightOnly(paths) { return paths.length > 0 && paths.every((path) => /(^docs?\/|\.md$|\.txt$|\.css$|\.scss$|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$)/i.test(path.replace(/\\/g, '/'))); }
function addReason(reasons, reason) { if (!reasons.some((existing) => existing.code === reason.code && existing.source === reason.source))
    reasons.push(reason); }
export function classifyRisk(input, governance) {
    const reasons = [];
    const paths = input.affectedPaths ?? [];
    for (const rule of governance.riskRules) {
        const pathHit = rule.pathPatterns?.some((pattern) => paths.some((path) => globMatches(path, pattern))) ?? false;
        const commandHit = rule.commandPatterns?.some((pattern) => (input.requestedCommands ?? []).some((command) => globMatches(command, pattern))) ?? false;
        if (pathHit || commandHit)
            addReason(reasons, { code: rule.code, source: pathHit ? 'affected-path' : 'requested-command', profile: rule.profile, nonDowngradable: rule.nonDowngradable ?? false });
    }
    if (input.dataClassification === 'RESTRICTED' || governance.dataClassification === 'RESTRICTED')
        addReason(reasons, { code: 'RESTRICTED_DATA', source: 'data-classification', profile: 'HIGH_RISK', nonDowngradable: true });
    if (input.dataClassification === 'CONFIDENTIAL' || governance.dataClassification === 'CONFIDENTIAL')
        addReason(reasons, { code: 'CONFIDENTIAL_DATA', source: 'data-classification', profile: 'HIGH_RISK', nonDowngradable: false });
    if (input.authorizationChange)
        addReason(reasons, { code: 'AUTHORIZATION_CHANGE', source: 'implementation-intent', profile: 'HIGH_RISK', nonDowngradable: false });
    if (input.credentialHandling)
        addReason(reasons, { code: 'CREDENTIAL_HANDLING', source: 'implementation-intent', profile: 'HIGH_RISK', nonDowngradable: true });
    if (input.databaseMigration)
        addReason(reasons, { code: 'DATABASE_SCHEMA_CHANGE', source: 'implementation-intent', profile: 'HIGH_RISK', nonDowngradable: false });
    if (input.architectureImpact)
        addReason(reasons, { code: 'ARCHITECTURE_CHANGE', source: 'architecture-impact', profile: 'HIGH_RISK', nonDowngradable: false });
    if (input.networkRequired)
        addReason(reasons, { code: 'NETWORK_REQUIREMENT', source: 'capability-request', profile: 'HIGH_RISK', nonDowngradable: false });
    if ((input.dependencyChanges ?? []).length > 0)
        addReason(reasons, { code: 'DEPENDENCY_CHANGE', source: 'dependency-change', profile: 'STANDARD', nonDowngradable: false });
    const text = `${input.implementationIntent ?? ''} ${Object.values(input.ticketMetadata ?? {}).join(' ')}`;
    if (/\b(auth|permission|credential|secret|migration|infrastructure|network|public api|cryptograph)/i.test(text))
        addReason(reasons, { code: 'SENSITIVE_IMPLEMENTATION_INTENT', source: 'discovered-intent', profile: 'HIGH_RISK', nonDowngradable: false });
    const base = lightweightOnly(paths) ? 'LIGHTWEIGHT' : 'STANDARD';
    return { minimumProfile: maximumProfile(base, ...reasons.map((reason) => reason.profile)), reasons: reasons.sort((a, b) => `${a.code}:${a.source}`.localeCompare(`${b.code}:${b.source}`)), input };
}
export function assertDowngradeAllowed(assessment, requested) {
    invariant(!assessment.reasons.some((reason) => reason.nonDowngradable && rank[requested] < rank[reason.profile]), 'Risk has a non-downgradable trigger', 'RISK_NON_DOWNGRADABLE');
}
//# sourceMappingURL=risk.js.map