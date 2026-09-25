import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { readJson, writeJsonAtomic, writeTextAtomic } from '../shared/fs.js';
import { credentialFreeEnvironment, requirePinnedImage, runProcess } from './containers.js';
import { checkDrift } from './session.js';
import { handoffFileName, reviewConfirmationHash } from './bindings.js';
import { listFiles, safePath, snapshot } from './files.js';
import { loadRuntimeSettings } from '../config/runtime.js';
import { CredentialStore } from '../providers/credentials.js';
import { parseSessionRecord } from '../schemas/validation.js';
const interactiveDocker = (args) => new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit', windowsHide: true, env: credentialFreeEnvironment(), shell: false });
    let cancelled;
    const cleanup = () => { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); };
    const cancel = (signal) => { cancelled = signal; if (!child.killed)
        child.kill(signal); };
    const onInterrupt = () => cancel('SIGINT');
    const onTerminate = () => cancel('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('exit', (code) => { cleanup(); resolve(cancelled === 'SIGINT' ? 130 : cancelled === 'SIGTERM' ? 143 : code ?? 1); });
});
/** The supplied digest is an administrator-built image containing this package, OPA and a provider. */
export class IsolatedEnvironment {
    runner;
    interactive;
    copilot;
    constructor(runner = runProcess, interactive = interactiveDocker, copilot = async (container, directory) => new (await import('../providers/adapters.js')).ProviderAdapter('copilot').launchAttachedContainer(container, directory)) {
        this.runner = runner;
        this.interactive = interactive;
        this.copilot = copilot;
    }
    async docker(args) { return this.runner('docker', args, { timeout: 30000, env: credentialFreeEnvironment() }); }
    async importImplementationHandoff(gateway, state, container, candidateHash) {
        const directory = await mkdtemp(join(tmpdir(), 'ai-delivery-handoff-import-'));
        try {
            await this.docker(['cp', `${container}:/payload/control/session.json`, join(directory, 'session.json')]);
            const exported = parseSessionRecord(await readJson(join(directory, 'session.json')));
            invariant(exported.id === state.id && exported.epoch === state.epoch && exported.role === 'implementation' && exported.workItem === state.workItem, 'Exported implementation session identity is invalid', 'HANDOFF_STALE');
            if (!exported.handoff) {
                delete state.handoff;
                await unlink(join(gateway.store.directory, handoffFileName)).catch(() => undefined);
                return;
            }
            await this.docker(['cp', `${container}:/payload/control/${handoffFileName}`, join(directory, handoffFileName)]);
            const content = await readFile(join(directory, handoffFileName), 'utf8');
            invariant(exported.handoff.contentHash === sha256(content) && exported.handoff.snapshotHash === candidateHash && exported.handoff.governanceHash === state.governanceHash && exported.handoff.manifestHash === state.manifestHash, 'Exported implementation handoff is not bound to the candidate', 'HANDOFF_STALE');
            await writeTextAtomic(join(gateway.store.directory, handoffFileName), content);
            state.handoff = exported.handoff;
        }
        finally {
            await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    async launchReview(gateway, provider, image) {
        const state = await gateway.current();
        invariant(state.role === 'review' && state.reviewOf, 'Isolated review session required', 'REVIEW_SESSION_REQUIRED');
        await checkDrift(gateway.workflow, gateway.store, state);
        await gateway.authorize('tool.invoke');
        const payload = await mkdtemp(join(tmpdir(), 'ai-delivery-review-environment-'));
        const source = join(payload, 'workspace');
        await mkdir(source);
        for (const path of await listFiles(state.workspace)) {
            try {
                await gateway.authorize('file.read', { path });
            }
            catch {
                continue;
            }
            const target = join(source, path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, await readFile(await safePath(state.workspace, path)), { flag: 'wx' });
        }
        const initial = await snapshot(source);
        const initialHash = hashObject(initial);
        const control = join(payload, 'control');
        const repository = join(control, 'repository');
        await mkdir(repository, { recursive: true });
        const { WorkflowRepository } = await import('../work-items/repository.js');
        const isolatedRepository = new WorkflowRepository(repository);
        const registry = { schemaVersion: 1, projects: [{ id: state.project, path: '.' }] };
        await isolatedRepository.saveRegistry(registry);
        const governance = await gateway.workflow.repository.loadGovernance(state.project);
        await writeJsonAtomic(join(repository, '.ai-delivery', 'governance.json'), governance);
        const runtime = await loadRuntimeSettings(gateway.workflow.repository.gitRoot);
        await writeJsonAtomic(join(repository, '.ai-delivery', 'runtime.json'), runtime);
        const item = await gateway.workflow.status(state.workItem);
        item.reviewSession = '/payload/control';
        await isolatedRepository.saveWorkItemSnapshot(item);
        for (const artifact of Object.values(item.artifacts))
            await isolatedRepository.writeArtifact(item.id, artifact.type, await gateway.workflow.repository.readArtifact(item.id, artifact.type));
        const baselineContent = join(payload, 'baseline-content');
        await cp(state.baselineContentRoot, baselineContent, { recursive: true });
        const runtimeState = { ...state, repository: '/payload/control/repository', hostRoot: '/payload/workspace', workspace: '/payload/workspace', baselineContentRoot: '/payload/baseline-content', expectedHost: initial, expectedWorkspace: initial, registryHash: hashObject(registry), runtime: 'CONTAINER' };
        await writeJsonAtomic(join(control, 'session.json'), runtimeState);
        await cp(join(gateway.store.directory, handoffFileName), join(control, handoffFileName), { force: false });
        const providerRoot = join(payload, 'provider');
        const providerRepository = join(providerRoot, 'repository', '.ai-delivery');
        await mkdir(providerRepository, { recursive: true });
        await writeJsonAtomic(join(providerRepository, 'runtime.json'), runtime);
        await writeJsonAtomic(join(providerRoot, 'session.json'), { ...runtimeState, repository: '/provider/repository', hostRoot: '/workspace', workspace: '/workspace', baselineContentRoot: '/provider/baseline-content' });
        const name = `ai-delivery-review-${randomUUID()}`;
        const volume = `${name}-data`;
        const seed = `${name}-seed`;
        const network = `${name}-network`;
        const controller = `${name}-controller`;
        const broker = `${name}-broker`;
        const brokerVolume = `${name}-broker-secret`;
        const brokerSeed = `${name}-broker-seed`;
        const brokerSecretDirectory = await mkdtemp(join(tmpdir(), 'ai-delivery-broker-secret-'));
        const proxy = `${name}-proxy`;
        const homeVolume = `${name}-home`;
        const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
        let brokerToken;
        const importDirectory = await mkdtemp(join(tmpdir(), 'ai-delivery-review-import-'));
        await this.docker(['volume', 'create', volume]);
        try {
            if (provider === 'copilot') {
                const providerWorkspace = join(payload, 'provider-workspace');
                await cp(source, providerWorkspace, { recursive: true });
                const vscode = join(providerWorkspace, '.vscode');
                await mkdir(vscode, { recursive: true });
                await writeJsonAtomic(join(vscode, 'mcp.json'), { servers: { 'ai-delivery': { type: 'stdio', command: 'node', args: ['/opt/ai-delivery/dist/src/mcp/relay-entry.js'], env: { AI_DELIVERY_CONTROLLER_HOST: controller, AI_DELIVERY_CONTROLLER_TOKEN: token } } } });
                await writeJsonAtomic(join(vscode, 'settings.json'), { 'chat.tools.global.autoApprove': false, 'chat.agent.maxRequests': 100, 'chat.hookFilesLocations': {}, 'terminal.integrated.enableMultiLinePasteWarning': true });
            }
            if (provider === 'codex' || provider === 'claude') {
                const model = runtime.providers[provider]?.model;
                invariant(model, `${provider} model is not configured`, 'PROVIDER_MODEL_REQUIRED');
                const credential = await new CredentialStore().get(provider);
                brokerToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
                const secretFile = join(brokerSecretDirectory, 'config.json');
                await writeJsonAtomic(secretFile, { provider, model, upstreamCredential: credential, sessionId: state.id, expiresAt: state.expiresAt, sessionToken: brokerToken });
            }
            await this.docker(['create', '--name', seed, '--network=none', '--mount', `type=volume,source=${volume},target=/payload`, image]);
            await this.docker(['cp', `${payload}/.`, `${seed}:/payload`]);
            await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--user', '0:0', '--security-opt=no-new-privileges', '--mount', `type=volume,source=${volume},target=/payload`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/payload']);
            await this.docker(['network', 'create', '--internal', network]);
            await this.docker(['run', '--detach', '--name', controller, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--env', `AI_DELIVERY_CONTROLLER_TOKEN=${token}`, '--mount', `type=volume,source=${volume},target=/payload`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/mcp/controller-entry.js']);
            let controllerReady = false;
            for (let attempt = 0; attempt < 30 && !controllerReady; attempt += 1) {
                try {
                    await this.docker(['exec', controller, '/usr/local/bin/node', '-e', "const s=require('net').connect(8788,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"]);
                    controllerReady = true;
                }
                catch {
                    await new Promise((done) => setTimeout(done, 100));
                }
            }
            invariant(controllerReady, 'Trusted review controller did not become ready', 'MCP_CONTROLLER_UNAVAILABLE');
            if (brokerToken) {
                const secretFile = join(brokerSecretDirectory, 'config.json');
                await this.docker(['volume', 'create', brokerVolume]);
                await this.docker(['create', '--name', brokerSeed, '--network=none', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret`, image]);
                await this.docker(['cp', secretFile, `${brokerSeed}:/broker-secret/config.json`]);
                await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--user', '0:0', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/broker-secret']);
                await this.docker(['run', '--detach', '--name', broker, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret,readonly`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/providers/broker-entry.js']);
                await this.docker(['network', 'connect', 'bridge', broker]);
                let brokerReady = false;
                for (let attempt = 0; attempt < 30 && !brokerReady; attempt += 1) {
                    try {
                        await this.docker(['exec', broker, '/usr/local/bin/node', '-e', "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]);
                        brokerReady = true;
                    }
                    catch {
                        await new Promise((done) => setTimeout(done, 100));
                    }
                }
                invariant(brokerReady, 'Trusted model broker did not become ready', 'BROKER_START_FAILED');
            }
            let exitCode;
            if (provider === 'copilot') {
                const domains = ['github.com', 'api.github.com', 'copilot-proxy.githubusercontent.com', 'githubcopilot.com', 'githubusercontent.com', 'vscode.dev', 'visualstudio.com', 'microsoft.com', 'microsoftonline.com'].join(',');
                await this.docker(['volume', 'create', homeVolume]);
                await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--user', '0:0', '--mount', `type=volume,source=${homeVolume},target=/home/vscode`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/home/vscode']);
                await this.docker(['run', '--detach', '--name', proxy, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--env', `AI_DELIVERY_ALLOWED_DOMAINS=${domains}`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/providers/proxy-entry.js']);
                await this.docker(['network', 'connect', 'bridge', proxy]);
                await this.docker(['run', '--detach', '--name', name, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--env', `HTTPS_PROXY=http://${proxy}:8080`, '--env', `HTTP_PROXY=http://${proxy}:8080`, '--env', `NO_PROXY=${controller}`, '--mount', `type=volume,source=${volume},target=/workspace,volume-subpath=provider-workspace,readonly`, '--mount', `type=volume,source=${homeVolume},target=/home/vscode`, '--workdir', '/workspace', '--entrypoint', '/usr/bin/tail', image, '-f', '/dev/null']);
                exitCode = await this.copilot(name, gateway.store.directory);
            }
            else {
                const networkArgs = brokerToken ? ['--network', network, '--env', `AI_DELIVERY_BROKER_URL=http://${broker}:8787`, '--env', `AI_DELIVERY_BROKER_TOKEN=${brokerToken}`] : ['--network', network];
                exitCode = await this.interactive(['run', '-i', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', ...networkArgs, '--cpus', '2', '--memory', '2048m', '--memory-swap', '2048m', '--pids-limit', '256', '--user', '65534:65534', '--tmpfs', '/tmp:rw,nosuid,size=512m', '--env', `AI_DELIVERY_CONTROLLER_HOST=${controller}`, '--env', `AI_DELIVERY_CONTROLLER_TOKEN=${token}`, '--mount', `type=volume,source=${volume},target=/workspace,volume-subpath=workspace,readonly`, '--mount', `type=volume,source=${volume},target=/provider,volume-subpath=provider,readonly`, '--workdir', '/workspace', '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/enforcement/remote-entry.js', provider]);
            }
            invariant(exitCode === 0, `Review provider exited with code ${exitCode}`, 'REVIEW_PROVIDER_FAILED');
            await this.docker(['cp', `${controller}:/payload/control/session.json`, join(importDirectory, 'session.json')]);
            await this.docker(['cp', `${controller}:/payload/control/review.md`, join(importDirectory, 'review.md')]);
            await this.docker(['cp', `${controller}:/payload/control/repository/.ai-delivery/evidence.jsonl`, join(importDirectory, 'evidence.jsonl')]).catch(() => undefined);
            const exported = parseSessionRecord(await readJson(join(importDirectory, 'session.json')));
            const submission = exported.reviewSubmission;
            const findings = await readFile(join(importDirectory, 'review.md'), 'utf8');
            invariant(exported.id === state.id && exported.epoch === state.epoch && exported.role === 'review' && exported.reviewOf === state.reviewOf, 'Exported review identity is invalid', 'REVIEW_SESSION_STALE');
            invariant(submission && submission.sourceSession === state.reviewOf && submission.snapshotHash === initialHash && submission.governanceHash === state.governanceHash && submission.manifestHash === state.manifestHash && submission.handoffHash === state.handoff?.contentHash && sha256(findings) === submission.findingsHash, 'Exported review is not bound to the validated candidate and handoff', 'REVIEW_SESSION_STALE');
            invariant(submission.confirmationHash === reviewConfirmationHash(state.id, { ...submission, handoffHash: submission.handoffHash }), 'Exported review confirmation hash is invalid', 'REVIEW_SESSION_STALE');
            await checkDrift(gateway.workflow, gateway.store, state);
            invariant(hashObject(await snapshot(state.workspace)) === initialHash, 'Review source changed during isolated review', 'WORKSPACE_DRIFT');
            const importPath = join(gateway.store.directory, 'review-import.json');
            const journal = { schemaVersion: 1, reviewSession: state.id, sourceSession: state.reviewOf, findingsHash: submission.findingsHash, confirmationHash: submission.confirmationHash, state: 'STAGED' };
            let existing;
            try {
                existing = await readJson(importPath);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            invariant(!existing || existing.reviewSession === journal.reviewSession && existing.confirmationHash === journal.confirmationHash, 'A different review import is already staged', 'REVIEW_IMPORT_STALE');
            if (existing?.state === 'IMPORTED') {
                const imported = (await gateway.store.load()).reviewSubmission;
                invariant(imported?.confirmationHash === submission.confirmationHash, 'Completed review import no longer matches session state', 'REVIEW_IMPORT_STALE');
                return { exitCode, reviewSession: state.id, submitted: true, confirmationHash: submission.confirmationHash };
            }
            if (!existing)
                await writeJsonAtomic(importPath, journal);
            await writeTextAtomic(join(gateway.store.directory, 'review.md'), findings);
            const current = await gateway.store.load();
            invariant(current.id === state.id, 'Review session changed during isolated review', 'SESSION_REVISION_CONFLICT');
            if (current.reviewSubmission)
                invariant(current.reviewSubmission.confirmationHash === submission.confirmationHash, 'Review session already contains a different submission', 'REVIEW_IMPORT_STALE');
            else {
                invariant(current.revision === state.revision, 'Review session changed during isolated review', 'SESSION_REVISION_CONFLICT');
                current.reviewSubmission = submission;
                await gateway.store.save(current);
            }
            await writeJsonAtomic(importPath, { ...journal, state: 'IMPORTED' });
            return { exitCode, reviewSession: state.id, submitted: true, confirmationHash: submission.confirmationHash };
        }
        finally {
            await this.docker(['rm', '-f', name]).catch(() => undefined);
            await this.docker(['rm', '-f', seed]).catch(() => undefined);
            await this.docker(['rm', '-f', broker]).catch(() => undefined);
            await this.docker(['rm', '-f', brokerSeed]).catch(() => undefined);
            await this.docker(['rm', '-f', controller]).catch(() => undefined);
            await this.docker(['rm', '-f', proxy]).catch(() => undefined);
            await this.docker(['volume', 'rm', volume]).catch(() => undefined);
            await this.docker(['volume', 'rm', brokerVolume]).catch(() => undefined);
            await this.docker(['volume', 'rm', homeVolume]).catch(() => undefined);
            await this.docker(['network', 'rm', network]).catch(() => undefined);
            await rm(brokerSecretDirectory, { recursive: true, force: true }).catch(() => undefined);
            await rm(importDirectory, { recursive: true, force: true }).catch(() => undefined);
            await rm(payload, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    async launch(gateway, provider, image) {
        requirePinnedImage(image);
        const current = await gateway.current();
        invariant(current.mode === 'ISOLATED_ENVIRONMENT', 'Environment mode required', 'ISOLATION_REQUIRED');
        if (current.role === 'review')
            return this.launchReview(gateway, provider, image);
        {
            const state = current;
            await checkDrift(gateway.workflow, gateway.store, state);
            await gateway.authorize('tool.invoke');
            const payload = await mkdtemp(join(tmpdir(), 'ai-delivery-environment-'));
            const source = join(payload, 'workspace');
            await mkdir(source);
            for (const path of await listFiles(state.workspace)) {
                try {
                    await gateway.authorize('file.read', { path });
                }
                catch {
                    continue;
                }
                const target = join(source, path);
                await mkdir(dirname(target), { recursive: true });
                await writeFile(target, await readFile(await safePath(state.workspace, path)), { flag: 'wx' });
            }
            const control = join(payload, 'control');
            const repository = join(control, 'repository');
            await mkdir(repository, { recursive: true });
            const { WorkflowRepository } = await import('../work-items/repository.js');
            const isolatedRepository = new WorkflowRepository(repository);
            const registry = { schemaVersion: 1, projects: [{ id: state.project, path: '.' }] };
            await isolatedRepository.saveRegistry(registry);
            await writeJsonAtomic(join(repository, '.ai-delivery', 'governance.json'), await gateway.workflow.repository.loadGovernance(state.project));
            try {
                await writeJsonAtomic(join(repository, '.ai-delivery', 'runtime.json'), await loadRuntimeSettings(gateway.workflow.repository.gitRoot));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            const item = await gateway.workflow.status(state.workItem);
            item.enforcementSession = '/payload/control';
            delete item.reviewSession;
            await isolatedRepository.saveWorkItemSnapshot(item);
            for (const artifact of Object.values(item.artifacts))
                await isolatedRepository.writeArtifact(item.id, artifact.type, await gateway.workflow.repository.readArtifact(item.id, artifact.type));
            const baselineContent = join(payload, 'baseline-content');
            await cp(state.baselineContentRoot, baselineContent, { recursive: true });
            const initial = await snapshot(source);
            const runtimeState = { ...state, repository: '/payload/control/repository', hostRoot: '/payload/workspace', workspace: '/payload/workspace', baselineContentRoot: '/payload/baseline-content', expectedHost: initial, expectedWorkspace: initial, baseline: initial, registryHash: hashObject(registry), runtime: 'CONTAINER' };
            await writeJsonAtomic(join(control, 'session.json'), runtimeState);
            const name = `ai-delivery-agent-${randomUUID()}`;
            const volume = `${name}-data`;
            const seed = `${name}-seed`;
            const network = `${name}-network`;
            const broker = `${name}-broker`;
            const brokerVolume = `${name}-broker-secret`;
            const brokerSeed = `${name}-broker-seed`;
            const brokerSecretDirectory = await mkdtemp(join(tmpdir(), 'ai-delivery-broker-secret-'));
            const controller = `${name}-controller`;
            const proxy = `${name}-proxy`;
            const homeVolume = `${name}-home`;
            let brokerToken;
            const candidate = await mkdtemp(join(tmpdir(), 'ai-delivery-candidate-'));
            await this.docker(['volume', 'create', volume]);
            try {
                if (provider === 'copilot') {
                    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
                    const vscode = join(source, '.vscode');
                    await mkdir(vscode);
                    await writeJsonAtomic(join(vscode, 'mcp.json'), { servers: { 'ai-delivery': { type: 'stdio', command: 'node', args: ['/opt/ai-delivery/dist/src/mcp/relay-entry.js'], env: { AI_DELIVERY_CONTROLLER_HOST: controller, AI_DELIVERY_CONTROLLER_TOKEN: token } } } });
                    await writeJsonAtomic(join(vscode, 'settings.json'), { 'chat.tools.global.autoApprove': false, 'chat.agent.maxRequests': 100, 'chat.hookFilesLocations': {}, 'terminal.integrated.enableMultiLinePasteWarning': true });
                    await this.docker(['network', 'create', '--internal', network]);
                    await this.docker(['volume', 'create', homeVolume]);
                    await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--user', '0:0', '--mount', `type=volume,source=${homeVolume},target=/home/vscode`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/home/vscode']);
                }
                if (provider === 'codex' || provider === 'claude') {
                    const runtime = await loadRuntimeSettings(gateway.workflow.repository.gitRoot);
                    const model = runtime.providers[provider]?.model;
                    invariant(model, `${provider} model is not configured`, 'PROVIDER_MODEL_REQUIRED');
                    const credential = await new CredentialStore().get(provider);
                    brokerToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
                    const secretFile = join(brokerSecretDirectory, 'config.json');
                    await writeJsonAtomic(secretFile, { provider, model, upstreamCredential: credential, sessionId: state.id, expiresAt: state.expiresAt, sessionToken: brokerToken });
                    await this.docker(['network', 'create', '--internal', network]);
                    await this.docker(['volume', 'create', brokerVolume]);
                    await this.docker(['create', '--name', brokerSeed, '--network=none', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret`, image]);
                    await this.docker(['cp', secretFile, `${brokerSeed}:/broker-secret/config.json`]);
                    await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--user', '0:0', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/broker-secret']);
                    await this.docker(['run', '--detach', '--name', broker, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--mount', `type=volume,source=${brokerVolume},target=/broker-secret,readonly`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/providers/broker-entry.js']);
                    await this.docker(['network', 'connect', 'bridge', broker]);
                    let ready = false;
                    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
                        try {
                            await this.docker(['exec', broker, '/usr/local/bin/node', '-e', "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)})"]);
                            ready = true;
                        }
                        catch {
                            await new Promise((resolve) => setTimeout(resolve, 100));
                        }
                    }
                    invariant(ready, 'Trusted model broker did not become ready', 'BROKER_START_FAILED');
                }
                await this.docker(['create', '--name', seed, '--network=none', '--mount', `type=volume,source=${volume},target=/payload`, image]);
                await this.docker(['cp', `${payload}/.`, `${seed}:/payload`]);
                await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--user', '0:0', '--security-opt=no-new-privileges', '--mount', `type=volume,source=${volume},target=/payload`, '--entrypoint', '/bin/chown', image, '-R', '65534:65534', '/payload']);
                if (provider === 'copilot') {
                    const token = (JSON.parse(await readFile(join(source, '.vscode', 'mcp.json'), 'utf8')).servers['ai-delivery'].env.AI_DELIVERY_CONTROLLER_TOKEN);
                    const domains = ['github.com', 'api.github.com', 'copilot-proxy.githubusercontent.com', 'githubcopilot.com', 'githubusercontent.com', 'vscode.dev', 'visualstudio.com', 'microsoft.com', 'microsoftonline.com'].join(',');
                    await this.docker(['run', '--detach', '--name', controller, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--env', `AI_DELIVERY_CONTROLLER_TOKEN=${token}`, '--mount', `type=volume,source=${volume},target=/payload`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/mcp/controller-entry.js']);
                    await this.docker(['run', '--detach', '--name', proxy, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m', '--env', `AI_DELIVERY_ALLOWED_DOMAINS=${domains}`, '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/providers/proxy-entry.js']);
                    await this.docker(['network', 'connect', 'bridge', proxy]);
                    await this.docker(['run', '--detach', '--name', name, '--network', network, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--env', 'HTTPS_PROXY=http://' + proxy + ':8080', '--env', 'HTTP_PROXY=http://' + proxy + ':8080', '--env', 'NO_PROXY=' + controller, '--mount', `type=volume,source=${volume},target=/workspace,volume-subpath=workspace,readonly`, '--mount', `type=volume,source=${homeVolume},target=/home/vscode`, '--workdir', '/workspace', '--entrypoint', '/usr/bin/tail', image, '-f', '/dev/null']);
                    await gateway.audit('COPILOT_REMOTE_STARTED', { container: name, controller, network, workspaceReadOnly: true, dockerSocket: false, allowedDomains: domains.split(',') });
                    const exitCode = await this.copilot(name, gateway.store.directory);
                    await this.docker(['cp', `${controller}:/payload/workspace/.`, candidate]);
                    const isolatedEvidence = join(gateway.store.directory, `isolated-evidence-${state.id}.jsonl`);
                    await this.docker(['cp', `${controller}:/payload/control/repository/.ai-delivery/evidence.jsonl`, isolatedEvidence]).catch(() => undefined);
                    await rm(join(candidate, '.vscode'), { recursive: true, force: true });
                    await snapshot(candidate);
                    await checkDrift(gateway.workflow, gateway.store, state);
                    state.workspace = candidate;
                    state.expectedWorkspace = await snapshot(candidate);
                    delete state.validation;
                    delete state.review;
                    await this.importImplementationHandoff(gateway, state, controller, hashObject(state.expectedWorkspace));
                    await gateway.store.save(state);
                    let isolatedEvidenceHash = '';
                    try {
                        isolatedEvidenceHash = sha256(await readFile(isolatedEvidence));
                    }
                    catch { /* No inner events were produced. */ }
                    await gateway.audit('ISOLATED_CANDIDATE_EXPORTED', { candidateHash: hashObject(state.expectedWorkspace), exitCode, provider, ...(isolatedEvidenceHash ? { isolatedEvidenceHash } : {}) });
                    return { exitCode, candidate };
                }
                await gateway.audit('ISOLATED_ENVIRONMENT_STARTED', { image, provider, sourceHash: hashObject(initial) });
                const networkArgs = brokerToken ? ['--network', network, '--env', 'AI_DELIVERY_BROKER_URL=http://' + broker + ':8787', '--env', `AI_DELIVERY_BROKER_TOKEN=${brokerToken}`] : ['--network=none'];
                const args = ['run', '-i', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', ...networkArgs, '--cpus', '2', '--memory', '2048m', '--memory-swap', '2048m', '--pids-limit', '256', '--user', '65534:65534', '--tmpfs', '/tmp:rw,nosuid,size=512m', '--env', 'HOME=/tmp', '--mount', `type=volume,source=${volume},target=/payload`, '--workdir', '/payload/workspace', '--entrypoint', '/usr/local/bin/node', image, '/opt/ai-delivery/dist/src/enforcement/environment-entry.js', provider];
                const exitCode = await this.interactive(args);
                await this.docker(['cp', `${name}:/payload/workspace/.`, candidate]);
                const isolatedEvidence = join(gateway.store.directory, `isolated-evidence-${state.id}.jsonl`);
                await this.docker(['cp', `${name}:/payload/control/repository/.ai-delivery/evidence.jsonl`, isolatedEvidence]).catch(() => undefined);
                await snapshot(candidate); // Reject exported links, junctions and special files before accepting it.
                await checkDrift(gateway.workflow, gateway.store, state);
                state.workspace = candidate;
                state.expectedWorkspace = await snapshot(candidate);
                delete state.validation;
                delete state.review;
                await this.importImplementationHandoff(gateway, state, name, hashObject(state.expectedWorkspace));
                await gateway.store.save(state);
                let isolatedEvidenceHash = '';
                try {
                    isolatedEvidenceHash = sha256(await readFile(isolatedEvidence));
                }
                catch { /* No inner events were produced. */ }
                await gateway.audit('ISOLATED_CANDIDATE_EXPORTED', { candidateHash: hashObject(state.expectedWorkspace), exitCode, ...(isolatedEvidenceHash ? { isolatedEvidenceHash } : {}) });
                return { exitCode, candidate };
            }
            finally {
                await this.docker(['rm', '-f', name]).catch(() => undefined);
                await this.docker(['rm', '-f', seed]).catch(() => undefined);
                await this.docker(['rm', '-f', broker]).catch(() => undefined);
                await this.docker(['rm', '-f', brokerSeed]).catch(() => undefined);
                await this.docker(['rm', '-f', controller]).catch(() => undefined);
                await this.docker(['rm', '-f', proxy]).catch(() => undefined);
                await this.docker(['volume', 'rm', volume]).catch(() => undefined);
                await this.docker(['volume', 'rm', brokerVolume]).catch(() => undefined);
                await this.docker(['volume', 'rm', homeVolume]).catch(() => undefined);
                await this.docker(['network', 'rm', network]).catch(() => undefined);
                await rm(brokerSecretDirectory, { recursive: true, force: true }).catch(() => undefined);
                // Keep filtered payload/candidate for investigation; no credentials are present and no host bind was used.
            }
        }
    }
    async copyRuntime(destination) { await cp(new URL('../../../policy', import.meta.url), join(destination, 'policy'), { recursive: true }); }
}
//# sourceMappingURL=environment.js.map