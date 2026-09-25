import { invariant } from '../shared/errors.js';
import { globMatches } from '../shared/glob.js';
export function checkGovernedPath(governance, path) {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.includes('../') || normalized === '..')
        return { allowed: false, reason: 'path traversal is denied' };
    if (governance.deniedPaths.some((pattern) => globMatches(normalized, pattern)))
        return { allowed: false, reason: 'path matches deniedPaths' };
    if (!governance.allowedPaths.some((pattern) => globMatches(normalized, pattern)))
        return { allowed: false, reason: 'path is outside allowedPaths' };
    return { allowed: true, reason: 'path is within governed scope' };
}
export function requireGovernedPath(governance, path) {
    const result = checkGovernedPath(governance, path);
    invariant(result.allowed, `Governance denied ${path}: ${result.reason}`, 'PATH_DENIED');
}
//# sourceMappingURL=scope.js.map