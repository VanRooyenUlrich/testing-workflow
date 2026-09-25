import { createHash } from 'node:crypto';
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function stableJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(',')}]`;
    }
    const object = value;
    return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
        .join(',')}}`;
}
export function hashObject(value) {
    return sha256(stableJson(value));
}
//# sourceMappingURL=hash.js.map