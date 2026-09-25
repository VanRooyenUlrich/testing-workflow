import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant } from '../shared/errors.js';
import { validateDockerAcceptanceChecks } from '../validation/release.js';
import { DATA_SCHEMA_VERSION, GOVERNANCE_VERSION, parseWorkflowVersion } from '../config/versions.js';
const schemaDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../../schemas');
const schemaFiles = [
    'capability-manifest.schema.json', 'confirmation.schema.json', 'credential-vault.schema.json', 'delivery-receipt.schema.json', 'docker-acceptance-receipt.schema.json', 'governance.schema.json', 'governance-v0.schema.json', 'live-acceptance-receipt.schema.json',
    'project-registry.schema.json', 'promotion-journal.schema.json', 'provider-compatibility.schema.json', 'provider-preparation.schema.json', 'review.schema.json', 'risk-assessment.schema.json', 'runtime-settings.schema.json', 'session.schema.json', 'session-transaction.schema.json', 'toolchain-receipt.schema.json', 'upgrade-journal.schema.json', 'work-item.schema.json',
];
const schemas = new Map(schemaFiles.map((file) => [file, JSON.parse(readFileSync(resolve(schemaDirectory, file), 'utf8'))]));
const supportedKeywords = new Set(['$schema', '$id', '$defs', '$ref', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'format', 'items', 'minItems', 'exclusiveMinimum', 'minimum', 'maximum', 'allOf']);
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function fail(path, message) { invariant(false, `${path} ${message}`, 'SCHEMA_INVALID'); }
function pointer(root, fragment) {
    let value = root;
    for (const token of fragment.replace(/^#\/?/, '').split('/').filter(Boolean)) {
        invariant(object(value), `Invalid schema reference: ${fragment}`, 'SCHEMA_DEFINITION_INVALID');
        value = value[token.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    invariant(object(value), `Invalid schema reference: ${fragment}`, 'SCHEMA_DEFINITION_INVALID');
    return value;
}
function reference(ref, root) {
    if (ref.startsWith('#'))
        return { schema: pointer(root, ref), root };
    const [file, fragment] = ref.split('#');
    const target = schemas.get(file);
    invariant(target, `Unknown schema reference: ${ref}`, 'SCHEMA_DEFINITION_INVALID');
    return { schema: fragment ? pointer(target, `#${fragment}`) : target, root: target };
}
function assertSupportedSchema(schema, location) {
    for (const key of Object.keys(schema))
        invariant(supportedKeywords.has(key), `Unsupported JSON Schema keyword at ${location}: ${key}`, 'SCHEMA_DEFINITION_INVALID');
    for (const container of ['$defs', 'properties'])
        if (object(schema[container]))
            for (const [key, child] of Object.entries(schema[container])) {
                invariant(object(child), `Invalid schema at ${location}.${container}.${key}`, 'SCHEMA_DEFINITION_INVALID');
                assertSupportedSchema(child, `${location}.${container}.${key}`);
            }
    if (object(schema.additionalProperties))
        assertSupportedSchema(schema.additionalProperties, `${location}.additionalProperties`);
    if (object(schema.items))
        assertSupportedSchema(schema.items, `${location}.items`);
    if (Array.isArray(schema.allOf))
        schema.allOf.forEach((child, index) => { invariant(object(child), `Invalid schema at ${location}.allOf[${index}]`, 'SCHEMA_DEFINITION_INVALID'); assertSupportedSchema(child, `${location}.allOf[${index}]`); });
}
for (const [file, schema] of schemas)
    assertSupportedSchema(schema, file);
function typeMatches(type, value) {
    if (type === 'null')
        return value === null;
    if (type === 'array')
        return Array.isArray(value);
    if (type === 'object')
        return object(value);
    if (type === 'integer')
        return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number')
        return typeof value === 'number' && Number.isFinite(value);
    return typeof value === type;
}
function validDateTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value)))
        return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59;
}
function validateNode(schema, value, path, root) {
    if (typeof schema.$ref === 'string') {
        const target = reference(schema.$ref, root);
        validateNode(target.schema, value, path, target.root);
        return;
    }
    if (Array.isArray(schema.allOf))
        for (const member of schema.allOf) {
            invariant(object(member), 'Invalid allOf schema member', 'SCHEMA_DEFINITION_INVALID');
            validateNode(member, value, path, root);
        }
    if ('const' in schema && !same(value, schema.const))
        fail(path, `must equal ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => same(entry, value)))
        fail(path, 'has an unsupported value');
    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some((type) => typeof type === 'string' && typeMatches(type, value)))
            fail(path, `must be ${types.join(' or ')}`);
    }
    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength)
            fail(path, `must contain at least ${schema.minLength} characters`);
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
            fail(path, `must contain at most ${schema.maxLength} characters`);
        if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
            fail(path, 'does not match the required pattern');
        if (schema.format === 'date-time' && !validDateTime(value))
            fail(path, 'must be an RFC 3339 date-time');
    }
    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum)
            fail(path, `must be at least ${schema.minimum}`);
        if (typeof schema.maximum === 'number' && value > schema.maximum)
            fail(path, `must be at most ${schema.maximum}`);
        if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
            fail(path, `must be greater than ${schema.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems)
            fail(path, `must contain at least ${schema.minItems} items`);
        if (object(schema.items))
            value.forEach((entry, index) => validateNode(schema.items, entry, `${path}[${index}]`, root));
    }
    if (object(value)) {
        const required = Array.isArray(schema.required) ? schema.required : [];
        for (const key of required)
            if (typeof key === 'string' && !Object.hasOwn(value, key))
                fail(`${path}.${key}`, 'is required');
        const properties = object(schema.properties) ? schema.properties : {};
        for (const [key, entry] of Object.entries(value)) {
            const property = properties[key];
            if (object(property))
                validateNode(property, entry, `${path}.${key}`, root);
            else if (schema.additionalProperties === false)
                fail(`${path}.${key}`, 'is not allowed');
            else if (object(schema.additionalProperties))
                validateNode(schema.additionalProperties, entry, `${path}.${key}`, root);
        }
    }
}
function validateSchema(file, value, label) {
    const schema = schemas.get(file);
    validateNode(schema, value, label, schema);
}
function versioned(value, label, expected = 1) {
    invariant(object(value), `${label} must be an object`, 'SCHEMA_INVALID');
    invariant(value.schemaVersion === expected, `Unsupported ${label} schema version`, 'SCHEMA_VERSION');
    return value;
}
export function parseProjectRegistry(value) {
    versioned(value, 'project registry');
    validateSchema('project-registry.schema.json', value, 'project registry');
    return value;
}
export function parseGovernance(value) {
    const root = versioned(value, 'governance', DATA_SCHEMA_VERSION);
    validateSchema('governance.schema.json', value, 'governance');
    const version = parseWorkflowVersion(String(root.workflowVersion));
    invariant(version.governance === GOVERNANCE_VERSION && version.schema === DATA_SCHEMA_VERSION, 'Unsupported governance workflow version', 'GOVERNANCE_VERSION_UNSUPPORTED');
    return value;
}
export function parseLegacyGovernance(value) {
    versioned(value, 'legacy governance');
    validateSchema('governance-v0.schema.json', value, 'legacy governance');
    return value;
}
export function parseGovernanceV1(value) {
    const root = versioned(value, 'governance v1');
    invariant(typeof root.workflowVersion === 'string', 'governance v1 workflowVersion must be a string', 'SCHEMA_INVALID');
    const source = parseWorkflowVersion(root.workflowVersion);
    invariant(source.schema === 1 && source.governance === 1, 'Governance v1 source has inconsistent version markers', 'GOVERNANCE_VERSION_UNSUPPORTED');
    const upgraded = { ...root, schemaVersion: DATA_SCHEMA_VERSION, workflowVersion: workflowVersionForValidation(root.workflowVersion), validation: { ...root.validation, builtInPolicy: true } };
    validateSchema('governance.schema.json', upgraded, 'governance v1');
    return root;
}
function workflowVersionForValidation(value) {
    const parsed = parseWorkflowVersion(value);
    return `${parsed.package}/governance-${GOVERNANCE_VERSION}/schema-${DATA_SCHEMA_VERSION}`;
}
export function parseWorkItem(value) {
    versioned(value, 'work item', DATA_SCHEMA_VERSION);
    validateSchema('work-item.schema.json', value, 'work item');
    return value;
}
export function parseWorkItemV1(value) {
    const root = versioned(value, 'work item v1');
    validateSchema('work-item.schema.json', { ...root, schemaVersion: DATA_SCHEMA_VERSION, gateVersion: root.state === 'COMPLETE' ? 0 : 1 }, 'work item v1');
    return root;
}
export function parseConfirmation(value) { validateSchema('confirmation.schema.json', value, 'confirmation'); return value; }
export function parseCapabilityManifest(value) { validateSchema('capability-manifest.schema.json', value, 'capability manifest'); return value; }
export function parseReview(value) { validateSchema('review.schema.json', value, 'review'); return value; }
export function parseSessionRecord(value) { versioned(value, 'session'); validateSchema('session.schema.json', value, 'session'); return value; }
export function parseSessionTransaction(value) { versioned(value, 'session transaction'); validateSchema('session-transaction.schema.json', value, 'session transaction'); return value; }
export function parseRuntimeSettings(value) { versioned(value, 'runtime settings'); validateSchema('runtime-settings.schema.json', value, 'runtime settings'); return value; }
export function parseCredentialVault(value) { versioned(value, 'credential vault'); validateSchema('credential-vault.schema.json', value, 'credential vault'); return value; }
export function parsePromotionJournal(value) { versioned(value, 'promotion journal'); validateSchema('promotion-journal.schema.json', value, 'promotion journal'); return value; }
export function parseDeliveryReceipt(value) { versioned(value, 'delivery receipt'); validateSchema('delivery-receipt.schema.json', value, 'delivery receipt'); return value; }
export function parseToolchainReceipt(value) { versioned(value, 'toolchain receipt'); validateSchema('toolchain-receipt.schema.json', value, 'toolchain receipt'); return value; }
export function parseLiveAcceptanceReceipt(value) { versioned(value, 'live acceptance receipt'); validateSchema('live-acceptance-receipt.schema.json', value, 'live acceptance receipt'); return value; }
export function parseProviderCompatibility(value) { versioned(value, 'provider compatibility'); validateSchema('provider-compatibility.schema.json', value, 'provider compatibility'); return value; }
export function parseProviderPreparationReceipt(value) { versioned(value, 'provider preparation'); validateSchema('provider-preparation.schema.json', value, 'provider preparation'); return value; }
export function parseDockerAcceptanceReceipt(value) {
    versioned(value, 'Docker acceptance receipt');
    validateSchema('docker-acceptance-receipt.schema.json', value, 'Docker acceptance receipt');
    validateDockerAcceptanceChecks(value.checks);
    return value;
}
export function parseUpgradeJournal(value) { validateSchema('upgrade-journal.schema.json', value, 'upgrade journal'); return value; }
//# sourceMappingURL=validation.js.map