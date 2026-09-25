import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProviderCompatibility } from '../schemas/validation.js';
const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../../containers/compatibility.json');
const manifest = parseProviderCompatibility(JSON.parse(readFileSync(path, 'utf8')));
function detectedVersion(reportedVersion) {
    const match = /(?:^|\D)(\d+)\.(\d+)\.(\d+)(?:\D|$)/u.exec(reportedVersion);
    return match ? { text: `${match[1]}.${match[2]}.${match[3]}`, parts: match.slice(1).map(Number) } : undefined;
}
function atLeast(detected, minimum) {
    const required = minimum.split('.').map(Number);
    for (let index = 0; index < detected.parts.length; index += 1) {
        if (detected.parts[index] > required[index])
            return true;
        if (detected.parts[index] < required[index])
            return false;
    }
    return true;
}
export function providerCompatibility(provider, reportedVersion) {
    const policy = manifest.providers[provider];
    if (policy.versionPolicy !== 'EXACT' && policy.versionPolicy !== 'MINIMUM')
        return { compatible: true };
    const detected = detectedVersion(reportedVersion);
    const compatible = detected && (policy.versionPolicy === 'EXACT' ? detected.text === policy.version : atLeast(detected, policy.version));
    const requirement = policy.versionPolicy === 'EXACT' ? `required ${policy.version}` : `minimum ${policy.version}`;
    return compatible ? { compatible: true } : { compatible: false, reason: `Unsupported ${policy.distribution} version ${detected?.text ?? JSON.stringify(reportedVersion)}; ${requirement}` };
}
//# sourceMappingURL=compatibility.js.map