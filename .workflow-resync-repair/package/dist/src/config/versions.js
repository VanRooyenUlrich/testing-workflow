import { invariant } from '../shared/errors.js';
export const PACKAGE_VERSION = '1.0.0';
export const DATA_SCHEMA_VERSION = 2;
export const GOVERNANCE_VERSION = 2;
export const SUPPORTED_GOVERNANCE_VERSIONS = [0, 1, 2];
export const SUPPORTED_DATA_SCHEMA_VERSIONS = [1, 2];
function compareSemver(left, right) {
    const parse = (value) => {
        const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
        invariant(match, `Invalid package version in workflowVersion: ${value}`, 'GOVERNANCE_VERSION_INVALID');
        return match.slice(1).map(Number);
    };
    const a = parse(left);
    const b = parse(right);
    for (let index = 0; index < 3; index += 1)
        if (a[index] !== b[index])
            return a[index] - b[index];
    return 0;
}
export function parseWorkflowVersion(value) {
    const match = /^(\d+\.\d+\.\d+)\/governance-(\d+)\/schema-(\d+)$/.exec(value);
    invariant(match, `Invalid workflowVersion: ${value}`, 'GOVERNANCE_VERSION_INVALID');
    const result = { package: match[1], governance: Number(match[2]), schema: Number(match[3]) };
    invariant(SUPPORTED_DATA_SCHEMA_VERSIONS.includes(result.schema), `Unsupported governance schema version: ${result.schema}`, 'UPGRADE_SCHEMA_UNSUPPORTED');
    invariant(SUPPORTED_GOVERNANCE_VERSIONS.includes(result.governance), `Unsupported governance version: ${result.governance}`, 'GOVERNANCE_VERSION_UNSUPPORTED');
    invariant(result.governance <= GOVERNANCE_VERSION && compareSemver(result.package, PACKAGE_VERSION) <= 0, `Forward governance version is not supported: ${value}`, 'GOVERNANCE_VERSION_FORWARD');
    return result;
}
export function workflowVersion(governanceVersion = GOVERNANCE_VERSION) {
    return `${PACKAGE_VERSION}/governance-${governanceVersion}/schema-${DATA_SCHEMA_VERSION}`;
}
//# sourceMappingURL=versions.js.map