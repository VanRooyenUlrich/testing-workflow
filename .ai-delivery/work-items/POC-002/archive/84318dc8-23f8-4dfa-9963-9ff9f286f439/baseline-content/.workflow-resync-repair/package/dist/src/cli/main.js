#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { detectCommands, detectProject, requiredToolchains } from '../config/detection.js';
import { initialize } from '../config/initialize.js';
import { applyUpgrade } from '../config/upgrade.js';
import { GitInspector } from '../git/git-inspector.js';
import { checkGovernedPath } from '../governance/scope.js';
import { WorkflowError, invariant } from '../shared/errors.js';
import { riskProfiles } from '../shared/types.js';
import { createProjectRegistry } from '../projects/projects.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { Workflow } from '../work-items/workflow.js';
import { booleanFlag, flag, flags, parseArguments } from './arguments.js';
import { help } from './help.js';
import { enforcementCommand } from './enforcement.js';
import { doctor, formatDoctorReport } from '../config/doctor.js';
import { nextAction } from '../work-items/next.js';
import { CredentialStore } from '../providers/credentials.js';
import { applyRecovery, inspectRecovery } from '../enforcement/recovery.js';
import { prepareToolchain, verifyToolchain } from '../config/toolchain.js';
import { suggestedAction } from './remediation.js';
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22)
    throw new WorkflowError(`Node.js 22 or newer is required; found ${process.versions.node}`, 'NODE_VERSION_UNSUPPORTED');
function output(value) { stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
async function rootFor(args) { const explicit = flag(args, 'root'); return explicit ? resolve(explicit) : new GitInspector(process.cwd()).repositoryRoot(); }
async function workflowFor(args) { return new Workflow(new WorkflowRepository(await rootFor(args))); }
async function contentFrom(args) { return readFile(resolve(flag(args, 'file', true)), 'utf8'); }
async function secretFromStdin() { let value = ''; for await (const chunk of stdin) {
    value += String(chunk);
    invariant(value.length <= 16384, 'Credential input is too large', 'CREDENTIAL_INVALID');
} return value.replace(/[\r\n]+$/, ''); }
function profileFrom(value) { if (value === undefined)
    return undefined; invariant(riskProfiles.includes(value), `Invalid profile: ${value}`, 'CLI_PROFILE_INVALID'); return value; }
async function confirm(prompt, expectedHash, reason) {
    invariant(stdin.isTTY && stdout.isTTY, 'This human-confirmed action requires an interactive TTY', 'CONFIRMATION_NOT_INTERACTIVE');
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
        stdout.write(`${prompt}${expectedHash ? `\nSHA-256: ${expectedHash}` : ''}\n`);
        const answer = await terminal.question('Type CONFIRM to continue: ');
        invariant(answer === 'CONFIRM', 'Confirmation cancelled', 'CONFIRMATION_CANCELLED');
        return { confirmed: true, interactive: true, localOsUser: userInfo().username, ...(reason === undefined ? {} : { reason }), ...(expectedHash === undefined ? {} : { presentedArtifactSha256: expectedHash }) };
    }
    finally {
        terminal.close();
    }
}
async function initCommand(args) {
    const cwd = resolve(flag(args, 'root') ?? process.cwd());
    const detection = await detectProject(cwd);
    let projects;
    const supplied = flags(args, 'project');
    if (supplied.length > 0)
        projects = supplied.map((value) => { const separator = value.indexOf(':'); invariant(separator > 0, `Invalid --project ${value}; expected id:path`, 'CLI_PROJECT_INVALID'); return { id: value.slice(0, separator), path: value.slice(separator + 1) }; });
    else if (stdin.isTTY && !booleanFlag(args, 'yes')) {
        const terminal = createInterface({ input: stdin, output: stdout });
        try {
            const suggested = detection.candidateApplications.length === 1 ? detection.candidateApplications[0] : '.';
            const path = (await terminal.question(`Project path [${suggested}]: `)).trim() || suggested;
            const defaultId = path === '.' ? 'app' : path.replace(/[^a-zA-Z0-9_-]/g, '-');
            const id = (await terminal.question(`Project identifier [${defaultId}]: `)).trim() || defaultId;
            projects = [{ id, path }];
        }
        finally {
            terminal.close();
        }
    }
    else
        projects = [{ id: flag(args, 'project-id') ?? 'app', path: flag(args, 'project-path') ?? '.' }];
    projects = createProjectRegistry(detection.gitRoot, projects).projects;
    const optionName = { node: 'node-image', bun: 'bun-image', dotnet: 'dotnet-image' };
    const toolchains = {};
    for (const kind of Object.keys(optionName)) {
        if (args.flags.has(optionName[kind]))
            toolchains[kind] = { image: flag(args, optionName[kind], true) };
    }
    const nodeModulesPath = args.flags.has('node-modules-path') ? flag(args, 'node-modules-path', true) : undefined;
    if (nodeModulesPath !== undefined && toolchains.node)
        toolchains.node.nodeModulesPath = nodeModulesPath;
    const required = new Set();
    for (const project of projects) {
        const commands = await detectCommands(join(detection.gitRoot, project.path === '.' ? '' : project.path), detection.packageManager);
        for (const kind of requiredToolchains(commands))
            required.add(kind);
    }
    const missing = [...required].filter((kind) => toolchains[kind] === undefined);
    if (missing.length > 0 && stdin.isTTY && stdout.isTTY && !booleanFlag(args, 'yes')) {
        const terminal = createInterface({ input: stdin, output: stdout });
        try {
            for (const kind of missing) {
                const image = (await terminal.question(`Pinned ${kind} toolchain image (name@sha256:digest or sha256:image-id): `)).trim();
                invariant(image.length > 0, `Pinned ${kind} toolchain image is required`, 'INIT_TOOLCHAIN_IMAGE_REQUIRED');
                toolchains[kind] = { image };
            }
        }
        finally {
            terminal.close();
        }
    }
    else
        invariant(missing.length === 0, `Pinned toolchain image required; supply ${missing.map((kind) => `--${optionName[kind]}`).join(', ')}`, 'INIT_TOOLCHAIN_IMAGE_REQUIRED');
    if (nodeModulesPath !== undefined && toolchains.node)
        toolchains.node.nodeModulesPath = nodeModulesPath;
    const selected = flags(args, 'provider');
    const providers = selected.length ? selected : ['generic-mcp'];
    const runtime = { schemaVersion: 1, providers: {} };
    for (const provider of providers) {
        if (provider === 'codex')
            runtime.providers.codex = { model: flag(args, 'codex-model', true) };
        else if (provider === 'claude')
            runtime.providers.claude = { model: flag(args, 'claude-model', true) };
        else if (provider === 'copilot')
            runtime.providers.copilot = { authentication: 'vscode-login' };
        else if (provider === 'generic-mcp')
            runtime.providers['generic-mcp'] = {};
        else
            invariant(false, `Unsupported provider: ${provider}`, 'PROVIDER_UNKNOWN');
    }
    const preview = await initialize({ cwd, projects, dryRun: true, toolchains, runtime });
    if (booleanFlag(args, 'dry-run') || !booleanFlag(args, 'force')) {
        output(booleanFlag(args, 'dry-run') ? preview : await initialize({ cwd, projects, dryRun: false, toolchains, runtime }));
        return;
    }
    output(preview);
    const accepted = await confirm('Apply the exact initialization merge plan and approved generated-file replacements?', preview.planHash);
    output(await initialize({ cwd, projects, dryRun: false, acceptedForceHash: accepted.presentedArtifactSha256, toolchains, runtime }));
}
async function upgradeCommand(args) {
    const root = await rootFor(args);
    const preview = await applyUpgrade(root, { dryRun: true });
    if (booleanFlag(args, 'dry-run')) {
        output(preview);
        return;
    }
    output(preview);
    const accepted = await confirm('Apply this exact versioned governance migration plan?', preview.planHash);
    output(await applyUpgrade(root, { dryRun: false, acceptedPlanHash: accepted.presentedArtifactSha256, resume: booleanFlag(args, 'resume') }));
}
async function dispatch(args) {
    const [group, action] = args.positionals;
    if (!group || group === 'help' || booleanFlag(args, 'help')) {
        stdout.write(help);
        return;
    }
    if (await enforcementCommand(args, confirm))
        return;
    if (group === 'init') {
        await initCommand(args);
        return;
    }
    if (group === 'upgrade') {
        await upgradeCommand(args);
        return;
    }
    if (group === 'doctor') {
        const report = await doctor(await rootFor(args));
        if (booleanFlag(args, 'json'))
            output(report);
        else
            stdout.write(formatDoctorReport(report));
        if (!report.ready)
            process.exitCode = 1;
        return;
    }
    if (group === 'credentials' && action === 'status') {
        output(await new CredentialStore().status());
        return;
    }
    if (group === 'credentials' && action === 'set') {
        const provider = args.positionals[2];
        invariant(provider === 'codex' || provider === 'claude', 'Credential provider must be codex or claude', 'PROVIDER_UNKNOWN');
        invariant(booleanFlag(args, 'stdin'), 'Pass the credential on standard input with --stdin', 'CREDENTIAL_INPUT_REQUIRED');
        await new CredentialStore().set(provider, await secretFromStdin());
        output({ provider, stored: true, protectedBy: 'Windows DPAPI' });
        return;
    }
    if (group === 'recover') {
        const root = await rootFor(args);
        const plan = await inspectRecovery(root);
        if (booleanFlag(args, 'dry-run'))
            output(plan);
        else if (booleanFlag(args, 'apply')) {
            output(plan);
            const accepted = await confirm('Apply this exact recovery plan?', plan.planHash);
            output(await applyRecovery(root, accepted.presentedArtifactSha256));
        }
        else
            invariant(false, 'Use recover --dry-run or recover --apply', 'CLI_ARGUMENT_REQUIRED');
        return;
    }
    if (group === 'toolchain' && action === 'prepare') {
        output(await prepareToolchain(await rootFor(args), flag(args, 'project', true)));
        return;
    }
    if (group === 'toolchain' && action === 'verify') {
        output(await verifyToolchain(await rootFor(args), flag(args, 'project', true)));
        return;
    }
    if (group === 'git') {
        const inspector = new GitInspector(flag(args, 'root') ?? process.cwd());
        if (action === 'root')
            output({ root: await inspector.repositoryRoot() });
        else if (action === 'status')
            stdout.write(`${await inspector.status()}\n`);
        else if (action === 'diff')
            stdout.write(`${await inspector.diff()}\n`);
        else if (action === 'changed')
            output(await inspector.changedFiles());
        else if (action === 'baseline')
            output({ commit: await inspector.baselineCommit() });
        else if (action === 'history')
            stdout.write(`${await inspector.fileHistory(flag(args, 'file', true), Number(flag(args, 'limit') ?? 20))}\n`);
        else
            throw new WorkflowError('Unknown git operation', 'CLI_COMMAND_UNKNOWN');
        return;
    }
    const workflow = await workflowFor(args);
    const id = flag(args, 'id');
    if (group === 'work' && action === 'create') {
        output(await workflow.create({ id: flag(args, 'id', true), project: flag(args, 'project', true), ...(flag(args, 'ticket') === undefined ? {} : { ticket: flag(args, 'ticket') }), ...(profileFrom(flag(args, 'profile')) === undefined ? {} : { profile: profileFrom(flag(args, 'profile')) }), risk: { affectedPaths: flags(args, 'path') } }));
        return;
    }
    if (group === 'work' && action === 'list') {
        output(await workflow.repository.listWorkItems());
        return;
    }
    invariant(id || group === 'evidence' || group === 'governance', '--id is required', 'CLI_ARGUMENT_REQUIRED');
    if (group === 'work' && action === 'status')
        output(await workflow.status(id));
    else if (group === 'work' && action === 'next')
        output(await nextAction(await workflow.status(id)));
    else if (group === 'discovery' && action === 'submit')
        output(await workflow.submitDiscovery(id, await contentFrom(args)));
    else if (group === 'spec' && action === 'submit')
        output(await workflow.submitSpecification(id, await contentFrom(args)));
    else if (group === 'spec' && action === 'accept') {
        const item = await workflow.status(id);
        const governance = await workflow.repository.loadGovernance(item.project);
        const required = item.selectedProfile !== 'LIGHTWEIGHT' || governance.confirmations.lightweightSpecification;
        output(await workflow.acceptSpecification(id, required ? await confirm('Accept this exact specification?', item.artifacts.specification?.sha256) : undefined));
    }
    else if (group === 'architecture' && action === 'submit')
        output(await workflow.submitArchitecture(id, await contentFrom(args)));
    else if (group === 'architecture' && action === 'approve') {
        const item = await workflow.status(id);
        output(await workflow.approveArchitecture(id, await confirm('Approve this architecture/security impact assessment?', item.artifacts['architecture-impact']?.sha256)));
    }
    else if (group === 'plan' && action === 'submit')
        output(await workflow.submitPlan(id, await contentFrom(args)));
    else if (group === 'plan' && action === 'approve') {
        const item = await workflow.status(id);
        const governance = await workflow.repository.loadGovernance(item.project);
        const required = item.selectedProfile !== 'LIGHTWEIGHT' || governance.confirmations.lightweightPlan;
        output(await workflow.approvePlan(id, required ? await confirm('Approve this exact plan?', item.artifacts.plan?.sha256) : undefined));
    }
    else if (group === 'risk' && action === 'show')
        output((await workflow.status(id)).risk);
    else if (group === 'risk' && action === 'assess')
        output(await workflow.assessRisk(id, {
            affectedPaths: flags(args, 'path'), dependencyChanges: flags(args, 'dependency'), requestedCommands: flags(args, 'command'),
            ...(args.flags.has('network') ? { networkRequired: booleanFlag(args, 'network') } : {}),
            ...(args.flags.has('db-migration') ? { databaseMigration: booleanFlag(args, 'db-migration') } : {}),
            ...(args.flags.has('authorization') ? { authorizationChange: booleanFlag(args, 'authorization') } : {}),
            ...(args.flags.has('credential') ? { credentialHandling: booleanFlag(args, 'credential') } : {}),
            ...(flag(args, 'intent') === undefined ? {} : { implementationIntent: flag(args, 'intent') }),
        }));
    else if (group === 'risk' && action === 'override') {
        const requested = profileFrom(flag(args, 'profile', true));
        const item = await workflow.status(id);
        const reduction = item.selectedProfile !== requested && riskProfiles.indexOf(requested) < riskProfiles.indexOf(item.selectedProfile);
        output(await workflow.overrideRisk(id, requested, reduction ? await confirm('Confirm risk reduction?', undefined, flag(args, 'reason', true)) : undefined));
    }
    else if (group === 'implementation' && action === 'begin')
        output(await workflow.beginImplementation(id));
    else if (group === 'implementation' && action === 'revise')
        output(await workflow.reviseImplementation(id, flag(args, 'reason', true)));
    else if (group === 'complete')
        output(await workflow.complete(id, await confirm('Mark this work item COMPLETE?')));
    else if (group === 'capability' && action === 'show')
        output(await workflow.capabilities(id));
    else if (group === 'governance' && action === 'check-path') {
        const repository = workflow.repository;
        const governance = await repository.loadGovernance(flag(args, 'project', true));
        output(checkGovernedPath(governance, flag(args, 'path', true)));
    }
    else if (group === 'evidence' && action === 'verify')
        output(await workflow.verifyEvidence());
    else
        throw new WorkflowError(`Unknown command: ${args.positionals.join(' ')}`, 'CLI_COMMAND_UNKNOWN');
}
const rawArguments = process.argv.slice(2);
const sessionEnvironment = rawArguments.indexOf('--session-env');
if (sessionEnvironment >= 0) {
    invariant(process.env.AI_DELIVERY_SESSION, 'AI_DELIVERY_SESSION is required with --session-env', 'CLI_ARGUMENT_REQUIRED');
    rawArguments.splice(sessionEnvironment, 1, '--session', process.env.AI_DELIVERY_SESSION);
}
dispatch(parseArguments(rawArguments)).catch((error) => {
    if (process.argv[2] === 'hook') {
        const hookEventName = process.argv[3] === 'post' ? 'PostToolUse' : 'PreToolUse';
        stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason: 'POLICY_UNAVAILABLE_OR_INVALID' } })}\n`);
        process.exitCode = 2;
        return;
    }
    const workflowError = error;
    const next = suggestedAction(workflowError.code);
    process.stderr.write(`${workflowError.code ? `[${workflowError.code}] ` : ''}${workflowError.message}${next ? `\nNext: ${next}` : ''}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=main.js.map