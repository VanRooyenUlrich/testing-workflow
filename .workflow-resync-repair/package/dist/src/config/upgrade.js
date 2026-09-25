import { copyFile, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createProjectRegistry } from '../projects/projects.js';
import { parseGovernance, parseGovernanceV1, parseLegacyGovernance, parseProjectRegistry, parseSessionRecord, parseUpgradeJournal, parseWorkItem, parseWorkItemV1 } from '../schemas/validation.js';
import { invariant } from '../shared/errors.js';
import { hashObject } from '../shared/hash.js';
import { readJson, writeJsonAtomic } from '../shared/fs.js';
import { DATA_SCHEMA_VERSION, GOVERNANCE_VERSION, PACKAGE_VERSION, parseWorkflowVersion, workflowVersion, } from './versions.js';
const journalName = 'upgrade-journal.json';
function journalPath(root) { return join(root, '.ai-delivery', journalName); }
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function readOptionalJson(path) {
    try {
        return await readJson(path);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
function planHash(plan) { return hashObject(plan); }
function sourceVersion(raw) {
    invariant(object(raw), 'Governance migration source must be an object', 'SCHEMA_INVALID');
    if (raw.workflowVersion === undefined) {
        parseLegacyGovernance(raw);
        return { package: '0.0.0', governance: 0, schema: 1 };
    }
    invariant(typeof raw.workflowVersion === 'string', 'governance.workflowVersion must be a string', 'SCHEMA_INVALID');
    const version = parseWorkflowVersion(raw.workflowVersion);
    if (version.governance === 0)
        parseLegacyGovernance(raw);
    else if (version.schema === 1)
        parseGovernanceV1(raw);
    else
        parseGovernance(raw);
    return version;
}
export const governanceMigrations = {
    0: (value) => {
        invariant(object(value.validation), 'Legacy governance validation must be an object', 'SCHEMA_INVALID');
        return { ...value, workflowVersion: '0.7.0/governance-1/schema-1', validation: { ...value.validation, policyCommands: value.validation.policyCommands ?? [] } };
    },
    1: (value) => {
        invariant(object(value.validation), 'Governance validation must be an object', 'SCHEMA_INVALID');
        return { ...value, schemaVersion: 2, workflowVersion: workflowVersion(2), validation: { ...value.validation, builtInPolicy: true } };
    },
};
export function migrateGovernance(value) {
    const version = sourceVersion(value);
    let current = value;
    const migrations = [];
    for (let from = version.governance; from < GOVERNANCE_VERSION; from += 1) {
        const migrate = governanceMigrations[from];
        invariant(migrate, `No governance migration exists for version ${from}`, 'GOVERNANCE_MIGRATION_MISSING');
        current = migrate(current);
        migrations.push(`governance-${from}-to-${from + 1}`);
    }
    const target = workflowVersion();
    if (current.workflowVersion !== target) {
        current = { ...current, workflowVersion: target };
        migrations.push('workflow-version');
    }
    return { governance: parseGovernance(current), from: version.package === '0.0.0' ? 'legacy/governance-0/schema-1' : String(value.workflowVersion), migrations };
}
export function migrateWorkItem(value) {
    invariant(object(value), 'Work-item migration source must be an object', 'SCHEMA_INVALID');
    if (value.schemaVersion === DATA_SCHEMA_VERSION)
        return { workItem: parseWorkItem(value), from: `schema-${DATA_SCHEMA_VERSION}`, migrations: [] };
    parseWorkItemV1(value);
    const completed = value.state === 'COMPLETE';
    const recoverable = typeof value.enforcementSession === 'string' && !completed ? value.enforcementSession : undefined;
    const review = object(value.review) ? { ...value.review, stale: true, staleReason: 'workflow upgraded to v1 gates' } : undefined;
    const validationEntries = Array.isArray(value.validations) ? value.validations : [];
    const migrated = {
        ...value,
        schemaVersion: DATA_SCHEMA_VERSION,
        gateVersion: completed ? 0 : 1,
        validations: validationEntries.map((entry) => object(entry) ? { ...entry, stale: true } : entry),
        ...(review === undefined ? {} : { review }),
        ...(recoverable === undefined ? {} : { recoverableCandidateSession: recoverable }),
    };
    delete migrated.enforcementSession;
    delete migrated.reviewSession;
    return { workItem: parseWorkItem(migrated), from: 'schema-1', migrations: ['work-item-schema-1-to-2', ...(completed ? ['historical-gates-preserved'] : ['execution-evidence-staled', 'active-sessions-revoked'])] };
}
async function registryPaths(root) {
    const parsed = parseProjectRegistry(await readJson(join(root, '.ai-delivery', 'projects.json')));
    const registry = createProjectRegistry(root, parsed.projects);
    const paths = new Map();
    for (const project of registry.projects)
        paths.set(project.id, join(root, project.path === '.' ? '' : project.path, '.ai-delivery', 'governance.json'));
    return paths;
}
async function workItemPaths(root) {
    const directory = join(root, '.ai-delivery', 'work-items');
    const paths = new Map();
    let entries;
    try {
        entries = await readdir(directory);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return paths;
        throw error;
    }
    for (const id of entries.sort())
        if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
            paths.set(id, join(directory, id, 'work-item.json'));
    return paths;
}
function withinRoot(root, path) {
    const rel = relative(resolve(root), resolve(path));
    return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function verifyPlanHash(plan) {
    const unsigned = { packageVersion: plan.packageVersion, schemaVersion: plan.schemaVersion, governanceVersion: plan.governanceVersion, operations: plan.operations };
    invariant(plan.planHash === planHash(unsigned), 'Upgrade plan hash is invalid', 'UPGRADE_JOURNAL_INVALID');
    invariant(plan.packageVersion === PACKAGE_VERSION && plan.schemaVersion === DATA_SCHEMA_VERSION && plan.governanceVersion === GOVERNANCE_VERSION, 'Upgrade journal was created by an incompatible workflow version', 'UPGRADE_JOURNAL_VERSION');
}
async function loadJournal(root) {
    const raw = await readOptionalJson(journalPath(root));
    if (raw === undefined)
        return undefined;
    const journal = parseUpgradeJournal(raw);
    verifyPlanHash(journal.plan);
    const governance = await registryPaths(root);
    const workItems = await workItemPaths(root);
    const allowed = new Map();
    for (const [project, path] of governance)
        allowed.set(path, { project, kind: 'governance' });
    for (const [id, path] of workItems) {
        const raw = await readJson(path);
        invariant(object(raw) && typeof raw.project === 'string', `Invalid work item during upgrade recovery: ${id}`, 'UPGRADE_JOURNAL_INVALID');
        allowed.set(path, { project: raw.project, kind: 'work-item' });
    }
    const planned = journal.plan.operations.filter((entry) => entry.action === 'MIGRATE');
    invariant(journal.operations.length === planned.length && new Set(journal.operations.map((entry) => entry.target)).size === journal.operations.length && planned.every((entry) => journal.operations.some((operation) => operation.target === entry.path)), 'Upgrade journal operation set is invalid', 'UPGRADE_JOURNAL_INVALID');
    for (const operation of journal.operations) {
        const plan = journal.plan.operations.find((entry) => entry.path === operation.target);
        const target = allowed.get(operation.target);
        invariant(plan && target?.project === plan.project && target.kind === plan.kind && withinRoot(root, operation.target), 'Upgrade journal path is outside the current workflow storage', 'UPGRADE_JOURNAL_INVALID');
        invariant(operation.temporary === `${operation.target}.ai-delivery-upgrade.next` && operation.backup === `${operation.target}.ai-delivery-upgrade.backup`, 'Upgrade journal staging path is invalid', 'UPGRADE_JOURNAL_INVALID');
        invariant(operation.currentHash === plan.currentHash && operation.proposedHash === plan.proposedHash && hashObject(operation.proposed) === plan.proposedHash, 'Upgrade journal hashes do not match the accepted plan', 'UPGRADE_JOURNAL_INVALID');
    }
    invariant(journal.pending.every((path) => journal.operations.some((entry) => entry.target === path)), 'Upgrade journal pending path is invalid', 'UPGRADE_JOURNAL_INVALID');
    return journal;
}
async function inspectFresh(root) {
    const paths = await registryPaths(root);
    const operations = [];
    for (const [project, path] of paths) {
        const raw = await readJson(path);
        const migrated = migrateGovernance(raw);
        const currentHash = hashObject(raw);
        const proposedHash = hashObject(migrated.governance);
        operations.push({ kind: 'governance', project, path, from: migrated.from, to: workflowVersion(), currentHash, proposedHash, divergent: false, action: currentHash === proposedHash ? 'UNCHANGED' : 'MIGRATE', migrations: migrated.migrations });
    }
    for (const [id, path] of await workItemPaths(root)) {
        const raw = await readJson(path);
        const migrated = migrateWorkItem(raw);
        const currentHash = hashObject(raw);
        const proposedHash = hashObject(migrated.workItem);
        operations.push({ kind: 'work-item', project: migrated.workItem.project, path, from: migrated.from, to: 'work-item/schema-2', currentHash, proposedHash, divergent: false, action: currentHash === proposedHash ? 'UNCHANGED' : 'MIGRATE', migrations: migrated.migrations });
        invariant(migrated.workItem.id === id, `Work-item ID does not match directory during upgrade: ${id}`, 'WORK_ID_MISMATCH');
    }
    const unsigned = { packageVersion: PACKAGE_VERSION, schemaVersion: DATA_SCHEMA_VERSION, governanceVersion: GOVERNANCE_VERSION, operations };
    return { ...unsigned, interrupted: false, planHash: planHash(unsigned) };
}
export async function inspectUpgrade(root) {
    const journal = await loadJournal(root);
    return journal ? { ...journal.plan, interrupted: true } : inspectFresh(root);
}
async function hashAt(path) {
    const raw = await readOptionalJson(path);
    return raw === undefined ? undefined : hashObject(raw);
}
async function ensureStaged(operation) {
    const targetHash = await hashAt(operation.target);
    invariant(targetHash === operation.currentHash || targetHash === operation.proposedHash, `Governance changed during upgrade recovery: ${operation.target}`, 'UPGRADE_RECOVERY_CONFLICT');
    const backupHash = await hashAt(operation.backup);
    if (backupHash === undefined && targetHash === operation.currentHash)
        await copyFile(operation.target, operation.backup, constants.COPYFILE_EXCL);
    else if (backupHash !== undefined)
        invariant(backupHash === operation.currentHash, `Upgrade backup is invalid: ${operation.target}`, 'UPGRADE_RECOVERY_CONFLICT');
    if (targetHash !== operation.proposedHash) {
        const temporaryHash = await hashAt(operation.temporary);
        if (temporaryHash === undefined)
            await writeFile(operation.temporary, `${JSON.stringify(operation.proposed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        else
            invariant(temporaryHash === operation.proposedHash, `Upgrade staging file is invalid: ${operation.target}`, 'UPGRADE_RECOVERY_CONFLICT');
        await rename(operation.temporary, operation.target);
    }
    invariant(await hashAt(operation.target) === operation.proposedHash, `Upgrade replacement failed: ${operation.target}`, 'UPGRADE_RECOVERY_CONFLICT');
}
async function finishJournal(root, journal, dependencies) {
    for (let index = 0; index < journal.operations.length; index += 1) {
        const operation = journal.operations[index];
        await ensureStaged(operation);
        const planOperation = journal.plan.operations.find((entry) => entry.path === operation.target);
        await dependencies.afterOperation?.(planOperation, index);
        journal.pending = journal.pending.filter((path) => path !== operation.target);
        await writeJsonAtomic(journalPath(root), journal);
    }
    for (const operation of journal.operations) {
        const planOperation = journal.plan.operations.find((entry) => entry.path === operation.target);
        const parsed = planOperation.kind === 'governance' ? parseGovernance(await readJson(operation.target)) : parseWorkItem(await readJson(operation.target));
        if (planOperation.kind === 'work-item')
            await revokeMigratedSessions(parsed);
        await unlink(operation.temporary).catch((error) => { if (error.code !== 'ENOENT')
            throw error; });
        await unlink(operation.backup).catch((error) => { if (error.code !== 'ENOENT')
            throw error; });
    }
    await unlink(journalPath(root));
}
async function revokeMigratedSessions(item) {
    if (!item.recoverableCandidateSession)
        return;
    const path = join(resolve(item.recoverableCandidateSession), 'session.json');
    let state;
    try {
        state = parseSessionRecord(await readJson(path));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return;
        throw error;
    }
    invariant(state.workItem === item.id && state.project === item.project, 'Recoverable session is not bound to migrated work item', 'SESSION_BINDING_INVALID');
    if (!state.closed || !state.revokedAt) {
        const revokedAt = new Date().toISOString();
        const revoked = { ...state, revision: state.revision + 1, closed: true, revokedAt, revokedReason: 'WORKFLOW_UPGRADED' };
        delete revoked.validation;
        delete revoked.review;
        delete revoked.reviewSubmission;
        await writeJsonAtomic(path, parseSessionRecord(revoked));
    }
}
export async function applyUpgrade(root, options, dependencies = {}) {
    const existing = await loadJournal(root);
    if (existing) {
        const interrupted = { ...existing.plan, interrupted: true };
        if (options.dryRun)
            return interrupted;
        invariant(options.resume, 'Interrupted upgrade detected; inspect and pass --resume', 'UPGRADE_INTERRUPTED');
        invariant(options.acceptedPlanHash === existing.plan.planHash, 'Explicit acceptance of the interrupted upgrade plan is required', 'UPGRADE_CONFIRMATION_REQUIRED');
        await finishJournal(root, existing, dependencies);
        return inspectFresh(root);
    }
    const plan = await inspectFresh(root);
    if (options.dryRun || plan.operations.every((entry) => entry.action === 'UNCHANGED'))
        return plan;
    invariant(options.acceptedPlanHash === plan.planHash, 'Explicit acceptance of the exact upgrade plan is required', 'UPGRADE_CONFIRMATION_REQUIRED');
    const operations = [];
    for (const operation of plan.operations.filter((entry) => entry.action === 'MIGRATE')) {
        const raw = await readJson(operation.path);
        invariant(hashObject(raw) === operation.currentHash, `Workflow data changed after preview: ${operation.project}`, 'UPGRADE_STALE');
        const proposed = operation.kind === 'governance' ? migrateGovernance(raw).governance : migrateWorkItem(raw).workItem;
        invariant(hashObject(proposed) === operation.proposedHash, `Upgrade proposal changed: ${operation.project}`, 'UPGRADE_STALE');
        operations.push({ target: operation.path, temporary: `${operation.path}.ai-delivery-upgrade.next`, backup: `${operation.path}.ai-delivery-upgrade.backup`, currentHash: operation.currentHash, proposedHash: operation.proposedHash, proposed });
    }
    const journal = { schemaVersion: 2, plan: { ...plan, interrupted: false }, operations, pending: operations.map((entry) => entry.target) };
    await mkdir(dirname(journalPath(root)), { recursive: true });
    await writeJsonAtomic(journalPath(root), journal);
    await finishJournal(root, journal, dependencies);
    return inspectFresh(root);
}
//# sourceMappingURL=upgrade.js.map