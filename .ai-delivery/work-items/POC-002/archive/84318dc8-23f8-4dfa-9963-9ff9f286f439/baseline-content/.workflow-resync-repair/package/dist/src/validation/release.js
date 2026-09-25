import { invariant } from '../shared/errors.js';
export const requiredDockerAcceptanceCheckIds = [
    'docker-linux-engine',
    'build-generic',
    'build-codex',
    'build-claude',
    'build-copilot',
    'restricted-runtime-generic',
    'restricted-runtime-codex',
    'restricted-runtime-claude',
    'restricted-runtime-copilot',
    'codex-version',
    'claude-version',
    'validation-offline',
    'isolated-review-generic-mcp',
    'vscode-home-writable',
];
export function validateDockerAcceptanceChecks(checks) {
    invariant(Array.isArray(checks), 'Docker acceptance checks must be an array', 'SCHEMA_INVALID');
    const ids = checks.map((check) => typeof check === 'object' && check !== null && typeof check.id === 'string' ? check.id : '');
    const duplicates = [...new Set(ids.filter((id, index) => id && ids.indexOf(id) !== index))].sort();
    invariant(duplicates.length === 0, `Docker acceptance check IDs must be unique: ${duplicates.join(', ')}`, 'SCHEMA_INVALID');
    const present = new Set(ids);
    const missing = requiredDockerAcceptanceCheckIds.filter((id) => !present.has(id));
    invariant(missing.length === 0, `Docker acceptance checks are missing: ${missing.join(', ')}`, 'SCHEMA_INVALID');
}
export function verifyAnnotatedTag(objectType, peeledTarget, head) {
    if (objectType !== 'tag')
        return { valid: false, detail: objectType ? `v1.0.0 is ${objectType}, not an annotated tag` : 'v1.0.0 is absent' };
    if (peeledTarget !== head)
        return { valid: false, detail: peeledTarget ? `v1.0.0 targets ${peeledTarget}, expected ${head}` : 'v1.0.0 cannot be peeled to a commit' };
    return { valid: true, detail: `annotated v1.0.0 targets ${head}` };
}
//# sourceMappingURL=release.js.map