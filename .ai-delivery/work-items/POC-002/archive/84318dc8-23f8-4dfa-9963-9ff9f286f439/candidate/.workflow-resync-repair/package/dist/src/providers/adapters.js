import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { hashObject, sha256 } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { SessionStore } from '../enforcement/session.js';
import { credentialFreeEnvironment, runProcess } from '../enforcement/containers.js';
import { loadRuntimeSettings } from '../config/runtime.js';
import { CredentialStore } from './credentials.js';
import { startModelBroker } from './broker.js';
import { providerCompatibility } from './compatibility.js';
import { readJson, withFileLock, writeJsonAtomic, writeTextAtomic } from '../shared/fs.js';
import { parseProviderPreparationReceipt } from '../schemas/validation.js';
export const providers = ['codex', 'claude', 'copilot', 'generic-mcp'];
function waitForProvider(child) {
    return new Promise((done, reject) => {
        let cancelled;
        const cleanup = () => { process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate); };
        const cancel = (signal) => { cancelled = signal; if (!child.killed)
            child.kill(signal); };
        const onInterrupt = () => cancel('SIGINT');
        const onTerminate = () => cancel('SIGTERM');
        process.once('SIGINT', onInterrupt);
        process.once('SIGTERM', onTerminate);
        child.once('error', (error) => { cleanup(); reject(error); });
        child.once('exit', (code) => { cleanup(); done(cancelled === 'SIGINT' ? 130 : cancelled === 'SIGTERM' ? 143 : code ?? 1); });
    });
}
const receiptName = 'provider-preparation.json';
function normalizedFiles(directory, files) {
    const entries = Object.entries(files).map(([path, content]) => {
        const name = relative(directory, path).replaceAll('\\', '/');
        invariant(name && name !== '..' && !name.startsWith('../') && !isAbsolute(name), 'Managed provider configuration escaped its directory', 'PROVIDER_CONFIG_UNSAFE');
        return [name, content];
    });
    return Object.fromEntries(entries.sort((left, right) => left[0].localeCompare(right[0])));
}
function receiptContext(provider, state, runtime, entrypoint, files, directory) {
    const normalized = normalizedFiles(directory, files);
    return {
        schemaVersion: 1, provider, sessionId: state.id, epoch: state.epoch, role: state.role,
        runtimeHash: hashObject(runtime), governanceHash: state.governanceHash, manifestHash: state.manifestHash,
        entrypoint: resolve(entrypoint), managedFiles: Object.fromEntries(Object.entries(normalized).map(([path, content]) => [path, sha256(content)])),
        configurationHash: hashObject(normalized),
    };
}
function samePreparationContext(left, right) {
    return left.provider === right.provider && left.sessionId === right.sessionId && left.epoch === right.epoch && left.role === right.role
        && left.runtimeHash === right.runtimeHash && left.governanceHash === right.governanceHash && left.manifestHash === right.manifestHash
        && left.entrypoint === right.entrypoint;
}
function sameStablePreparationContext(left, right) {
    return left.provider === right.provider && left.sessionId === right.sessionId && left.epoch === right.epoch
        && left.runtimeHash === right.runtimeHash && left.governanceHash === right.governanceHash
        && left.entrypoint === right.entrypoint;
}
function permittedControllerRotation(left, right) {
    return sameStablePreparationContext(left, right) && left.role === 'implementation' && right.role === 'validation';
}
/** Flags must be found in the installed binary; version strings are informational, not proof. */
export class ProviderAdapter {
    provider;
    runner;
    platform;
    localAppData;
    processLauncher;
    brokerStarter;
    credentialReader;
    broker;
    constructor(provider, runner = runProcess, platform = process.platform, localAppData = process.env.LOCALAPPDATA, processLauncher = (prepared) => waitForProvider(spawn(prepared.executable, prepared.args, { cwd: prepared.cwd, env: prepared.env, stdio: 'inherit', windowsHide: true, shell: false })), brokerStarter = startModelBroker, credentialReader = (selected) => new CredentialStore(this.localAppData).get(selected)) {
        this.provider = provider;
        this.runner = runner;
        this.platform = platform;
        this.localAppData = localAppData;
        this.processLauncher = processLauncher;
        this.brokerStarter = brokerStarter;
        this.credentialReader = credentialReader;
    }
    async command() {
        if (this.provider !== 'copilot')
            return { executable: this.provider, prefix: [], env: {} };
        if (this.platform !== 'win32' || !this.localAppData)
            return { executable: 'code', prefix: [], env: {} };
        const root = join(this.localAppData, 'Programs', 'Microsoft VS Code');
        try {
            const shim = await readFile(join(root, 'bin', 'code.cmd'), 'utf8');
            const release = /%~dp0\.\.\\([a-z0-9._-]+)\\resources\\app\\out\\cli\.js/i.exec(shim)?.[1];
            invariant(release, 'VS Code Windows CLI shim is unrecognized', 'PROVIDER_UNAVAILABLE');
            return { executable: join(root, 'Code.exe'), prefix: [join(root, release, 'resources', 'app', 'out', 'cli.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
        }
        catch {
            return { executable: join(root, 'Code.exe'), prefix: [], env: {} };
        }
    }
    async inspectCapabilities() {
        let help = '';
        let version = '';
        let installed = false;
        let copilotVersion = '';
        const command = await this.command();
        const env = { ...credentialFreeEnvironment(), ...command.env };
        if (this.provider !== 'generic-mcp')
            try {
                help = (await this.runner(command.executable, [...command.prefix, '--help'], { timeout: 10000, env })).stdout;
                version = (await this.runner(command.executable, [...command.prefix, '--version'], { timeout: 10000, env })).stdout.trim();
                installed = true;
            }
            catch { /* Missing or uninspectable is insufficient. */ }
        const codex = this.provider === 'codex';
        const claude = this.provider === 'claude';
        const copilot = this.provider === 'copilot';
        if (copilot && installed)
            try {
                const extensions = await this.runner(command.executable, [...command.prefix, '--list-extensions', '--show-versions'], { timeout: 10000, env });
                copilotVersion = /^github\.copilot@([^\r\n]+)$/imu.exec(extensions.stdout)?.[1]?.trim() ?? '';
                installed = copilotVersion.length > 0;
                if (installed)
                    version = `VS Code ${version}; GitHub.copilot ${copilotVersion}`;
            }
            catch {
                installed = false;
            }
        const compatibility = installed ? providerCompatibility(this.provider, copilotVersion || version) : { compatible: false };
        const verified = installed && compatibility.compatible;
        const sandbox = codex && verified && help.includes('--sandbox') && help.includes('--ask-for-approval');
        const nativeWriteRemoval = copilot && verified || claude && verified && help.includes('--tools') && help.includes('--disallowedTools');
        const shellRemoval = copilot && installed || nativeWriteRemoval || codex && help.includes('--disable');
        const mcpRestriction = copilot && verified || claude && verified && help.includes('--strict-mcp-config') && help.includes('--mcp-config');
        const unsupported = [];
        if (!installed)
            unsupported.push(copilot ? 'VS Code with the GitHub Copilot extension is missing or cannot be inspected' : 'Provider executable missing or cannot be inspected');
        else if (!compatibility.compatible)
            unsupported.push(compatibility.reason ?? 'Provider version is unsupported');
        if (!nativeWriteRemoval)
            unsupported.push('Native write tool removal not verified');
        if (!shellRemoval)
            unsupported.push('Native shell removal not verified');
        if (!mcpRestriction)
            unsupported.push('Exclusive MCP server enforcement not verified');
        if (!copilot)
            unsupported.push('Network confinement of the entire provider process not verified');
        if (copilot && installed)
            unsupported.push('VS Code hook activation, Copilot login, and tool execution location require the live release check');
        if (this.platform === 'win32')
            unsupported.push('Native Windows VS Code hooks are not a cross-provider OS sandbox');
        return { installed, compatible: compatibility.compatible, version, nativeWriteRemoval, shellRemoval, mcpRestriction, hooks: copilot && verified, networkBoundary: copilot && verified, sandbox: sandbox || copilot && verified, unsupported, quality: verified && copilot ? 'FULL' : verified && (sandbox || nativeWriteRemoval) ? 'PARTIAL' : 'INSUFFICIENT' };
    }
    static readiness(provider, capability) {
        if (provider === 'generic-mcp')
            return { status: 'WARN', message: 'Generic MCP stdio transport is available; external client controls and authentication require separate verification.' };
        if (!capability.installed)
            return { status: 'FAIL', message: 'Selected provider executable is not installed or cannot be inspected.' };
        if (!capability.compatible)
            return { status: 'FAIL', message: capability.unsupported.join('; ') || 'Selected provider version is incompatible.' };
        if (capability.quality === 'INSUFFICIENT')
            return { status: 'FAIL', message: capability.unsupported.join('; ') || 'Selected provider controls are insufficient.' };
        return { status: 'PASS', message: `${capability.version || 'unknown version'} (${capability.quality})` };
    }
    async build(options) {
        const { state, configurationDirectory, controlDirectory, entrypoint, capabilities, configuredModel, brokerUrl, brokerToken } = options;
        const files = {};
        const relayHost = process.env.AI_DELIVERY_CONTROLLER_HOST;
        const relayToken = process.env.AI_DELIVERY_CONTROLLER_TOKEN;
        const relay = relayHost && relayToken;
        const mcp = relay
            ? { command: process.execPath, args: ['/opt/ai-delivery/dist/src/mcp/relay-entry.js'], env: { AI_DELIVERY_CONTROLLER_HOST: relayHost, AI_DELIVERY_CONTROLLER_TOKEN: relayToken } }
            : { command: process.execPath, args: [entrypoint, 'mcp', 'serve', '--session', controlDirectory], env: {} };
        const mcpPath = join(configurationDirectory, 'mcp.json');
        files[mcpPath] = JSON.stringify({ mcpServers: { 'ai-delivery': mcp } }, null, 2);
        const command = await this.command();
        const env = { ...credentialFreeEnvironment(), ...command.env };
        const providerHome = join(configurationDirectory, 'provider-home');
        await mkdir(providerHome, { recursive: true });
        env.HOME = providerHome;
        env.USERPROFILE = providerHome;
        let executable = this.provider;
        let args = [];
        if (brokerToken)
            env.AI_DELIVERY_BROKER_TOKEN = brokerToken;
        if (relay) {
            env.AI_DELIVERY_CONTROLLER_HOST = relayHost;
            env.AI_DELIVERY_CONTROLLER_TOKEN = relayToken;
        }
        if (this.provider === 'codex') {
            env.CODEX_HOME = providerHome;
            const sandbox = state.role === 'implementation' ? 'workspace-write' : 'read-only';
            const model = configuredModel && brokerUrl ? `model = ${JSON.stringify(configuredModel)}\nmodel_provider = "ai_delivery"\n[model_providers.ai_delivery]\nname = "AI Delivery Broker"\nbase_url = ${JSON.stringify(`${brokerUrl}/v1`)}\nenv_key = "AI_DELIVERY_BROKER_TOKEN"\nwire_api = "responses"\n` : '';
            files[join(providerHome, 'config.toml')] = `${model}sandbox_mode = ${JSON.stringify(sandbox)}\napproval_policy = "never"\nweb_search = "disabled"\n[features]\napps = false\nskill_mcp_dependency_install = false\nshell_tool = false\nunified_exec = false\n[sandbox_workspace_write]\nnetwork_access = false\nexclude_slash_tmp = true\nexclude_tmpdir_env_var = true\n[shell_environment_policy]\ninherit = "none"\n[mcp_servers.ai-delivery]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify(mcp.args)}\nrequired = true\n`;
            args = ['--sandbox', sandbox, '--ask-for-approval', 'never', '--disable', 'shell_tool', '--disable', 'unified_exec', '--cd', state.workspace];
        }
        else if (this.provider === 'claude') {
            env.CLAUDE_CONFIG_DIR = providerHome;
            if (configuredModel && brokerUrl && brokerToken) {
                env.ANTHROPIC_BASE_URL = brokerUrl;
                env.ANTHROPIC_AUTH_TOKEN = brokerToken;
            }
            const settings = join(configurationDirectory, 'claude-settings.json');
            files[settings] = JSON.stringify({ permissions: { defaultMode: 'dontAsk', additionalDirectories: [], allow: ['mcp__ai-delivery__*'], deny: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent'] } }, null, 2);
            args = [...(configuredModel ? ['--model', configuredModel] : []), '--tools', '', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Agent', '--allowedTools', 'mcp__ai-delivery__*', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', mcpPath, '--settings', settings, '--setting-sources', ''];
        }
        else if (this.provider === 'copilot') {
            executable = command.executable;
            const workspaceFile = join(configurationDirectory, 'ai-delivery.code-workspace');
            const hookFile = join(configurationDirectory, 'hooks.json');
            const hook = (phase) => ({ type: 'command', command: `node "%AI_DELIVERY_ENTRY%" hook ${phase} --session "%AI_DELIVERY_SESSION%"`, windows: `node "%AI_DELIVERY_ENTRY%" hook ${phase} --session "%AI_DELIVERY_SESSION%"`, linux: `node "$AI_DELIVERY_ENTRY" hook ${phase} --session "$AI_DELIVERY_SESSION"`, osx: `node "$AI_DELIVERY_ENTRY" hook ${phase} --session "$AI_DELIVERY_SESSION"`, env: { AI_DELIVERY_ENTRY: entrypoint, AI_DELIVERY_SESSION: controlDirectory }, timeout: 15 });
            files[hookFile] = JSON.stringify({ hooks: { PreToolUse: [hook('pre')], PostToolUse: [hook('post')] } }, null, 2);
            files[workspaceFile] = JSON.stringify({ folders: [{ path: state.workspace }], settings: { 'chat.tools.global.autoApprove': false, 'chat.hookFilesLocations': { [hookFile]: true } }, mcp: { servers: { 'ai-delivery': { type: 'stdio', ...mcp } } } }, null, 2);
            args = [...command.prefix, '--new-window', '--wait', '--user-data-dir', providerHome, workspaceFile];
        }
        else {
            executable = process.execPath;
            args = mcp.args;
        }
        return { provider: this.provider, executable, args, cwd: state.workspace, env, files, configurationHash: hashObject(normalizedFiles(configurationDirectory, files)), capabilities, requiresEnvironment: state.mode === 'ISOLATED_ENVIRONMENT' || state.manifest.riskProfile === 'HIGH_RISK' && capabilities.quality === 'INSUFFICIENT' };
    }
    async verifyReceipt(prepared) {
        const receipt = parseProviderPreparationReceipt(await readJson(join(prepared.sessionDirectory, receiptName)));
        invariant(hashObject(receipt) === hashObject(prepared.receipt), 'Provider preparation receipt changed', 'PROVIDER_PREPARATION_STALE');
        const actual = {};
        for (const [name, expected] of Object.entries(receipt.managedFiles)) {
            const path = resolve(prepared.sessionDirectory, name);
            const root = resolve(prepared.sessionDirectory);
            invariant(path.startsWith(`${root}\\`) || path.startsWith(`${root}/`), 'Provider preparation path escaped the session', 'PROVIDER_CONFIG_UNSAFE');
            let content;
            try {
                content = await readFile(path, 'utf8');
            }
            catch {
                invariant(false, `Prepared provider file is missing: ${name}`, 'PROVIDER_PREPARATION_STALE');
            }
            invariant(sha256(content) === expected, `Prepared provider file changed: ${name}`, 'PROVIDER_PREPARATION_STALE');
            actual[name] = content;
        }
        invariant(hashObject(actual) === receipt.configurationHash, 'Prepared provider configuration changed', 'PROVIDER_PREPARATION_STALE');
    }
    async prepareSession(state, directory, entrypoint) {
        const sessionDirectory = resolve(directory);
        const resolvedEntrypoint = resolve(entrypoint);
        const runtime = await loadRuntimeSettings(state.repository);
        const capabilities = await this.inspectCapabilities();
        const generated = await this.build({ state, configurationDirectory: sessionDirectory, controlDirectory: sessionDirectory, entrypoint: resolvedEntrypoint, capabilities });
        const proposed = receiptContext(this.provider, state, runtime, resolvedEntrypoint, generated.files, sessionDirectory);
        const receiptPath = join(sessionDirectory, receiptName);
        await withFileLock(`${receiptPath}.lock`, async () => {
            let current;
            try {
                current = parseProviderPreparationReceipt(await readJson(receiptPath));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
            if (current) {
                invariant(current.provider === this.provider, `Session was prepared for ${current.provider}; create a replacement session to use ${this.provider}`, 'PROVIDER_PREPARATION_PROVIDER_MISMATCH');
                await this.verifyReceipt({ ...generated, sessionDirectory, entrypoint: resolvedEntrypoint, receipt: current });
                if (samePreparationContext(current, proposed)) {
                    invariant(hashObject(current) === hashObject(proposed), 'Prepared provider content no longer matches current settings', 'PROVIDER_PREPARATION_STALE');
                    return;
                }
                invariant(permittedControllerRotation(current, proposed), 'Provider preparation no longer matches the session, runtime, governance, capabilities, role or entrypoint; create a replacement session', 'PROVIDER_PREPARATION_STALE');
            }
            else
                for (const path of Object.keys(generated.files))
                    try {
                        await readFile(path);
                        invariant(false, 'Legacy provider configuration has no preparation receipt; create a replacement session', 'PROVIDER_PREPARATION_LEGACY');
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            throw error;
                    }
            for (const [path, content] of Object.entries(generated.files))
                await writeTextAtomic(path, content);
            await writeJsonAtomic(receiptPath, parseProviderPreparationReceipt(proposed));
        });
        const receipt = parseProviderPreparationReceipt(await readJson(receiptPath));
        const prepared = { ...generated, sessionDirectory, entrypoint: resolvedEntrypoint, receipt };
        await this.validateConfiguration(prepared);
        return prepared;
    }
    async validateConfiguration(prepared) {
        await this.verifyReceipt(prepared);
        invariant(!prepared.args.some((arg) => /danger-full-access|dangerously-bypass|skip-permissions/.test(arg)), 'Unsafe provider options', 'PROVIDER_CONFIG_UNSAFE');
        invariant(prepared.provider === 'generic-mcp' || prepared.capabilities.installed, prepared.capabilities.unsupported.join('; '), 'PROVIDER_UNAVAILABLE');
        invariant(prepared.provider === 'generic-mcp' || prepared.capabilities.compatible, prepared.capabilities.unsupported.join('; '), 'PROVIDER_VERSION_UNSUPPORTED');
        if (prepared.provider === 'codex')
            invariant(prepared.capabilities.sandbox && prepared.capabilities.shellRemoval, 'Codex required controls unavailable', 'PROVIDER_CONTROLS_UNAVAILABLE');
        if (prepared.provider === 'claude')
            invariant(prepared.capabilities.nativeWriteRemoval && prepared.capabilities.mcpRestriction, 'Claude required controls unavailable', 'PROVIDER_CONTROLS_UNAVAILABLE');
    }
    async runtimePrepared(state, controlDirectory, entrypoint, capabilities) {
        const runtime = await loadRuntimeSettings(state.repository);
        const configuredModel = this.provider === 'codex' || this.provider === 'claude' ? runtime.providers[this.provider]?.model : undefined;
        let brokerUrl = process.env.AI_DELIVERY_BROKER_URL;
        let brokerToken = process.env.AI_DELIVERY_BROKER_TOKEN;
        if (configuredModel && (!brokerUrl || !brokerToken)) {
            invariant(this.platform === 'win32', 'Configured model provider requires a trusted broker boundary', 'BROKER_REQUIRED');
            const credential = await this.credentialReader(this.provider);
            this.broker = await this.brokerStarter({ provider: this.provider, model: configuredModel, upstreamCredential: credential, sessionId: state.id, expiresAt: state.expiresAt, auditDirectory: controlDirectory });
            brokerUrl = this.broker.baseUrl;
            brokerToken = this.broker.token;
        }
        const attempt = await mkdtemp(join(tmpdir(), 'ai-delivery-provider-launch-'));
        try {
            const prepared = await this.build({ state, configurationDirectory: attempt, controlDirectory, entrypoint, capabilities, ...(configuredModel ? { configuredModel } : {}), ...(brokerUrl ? { brokerUrl } : {}), ...(brokerToken ? { brokerToken } : {}) });
            for (const [path, content] of Object.entries(prepared.files))
                await writeFile(path, content, { flag: 'wx', mode: 0o600 });
            return { prepared, attempt };
        }
        catch (error) {
            await rm(attempt, { recursive: true, force: true });
            throw error;
        }
    }
    async spawnPrepared(prepared) {
        return this.processLauncher(prepared);
    }
    async launch(prepared) {
        await this.validateConfiguration(prepared);
        invariant(!prepared.requiresEnvironment, 'Host launch denied: use the isolated environment runner', 'ISOLATION_REQUIRED');
        const state = await new SessionStore(prepared.sessionDirectory).load();
        invariant(state.id === prepared.receipt.sessionId && state.epoch === prepared.receipt.epoch && state.role === prepared.receipt.role && state.governanceHash === prepared.receipt.governanceHash && state.manifestHash === prepared.receipt.manifestHash, 'Session changed after provider preparation', 'PROVIDER_PREPARATION_STALE');
        let runtime;
        try {
            runtime = await this.runtimePrepared(state, prepared.sessionDirectory, prepared.entrypoint, prepared.capabilities);
            return await this.spawnPrepared(runtime.prepared);
        }
        finally {
            await this.cleanup();
            if (runtime)
                await rm(runtime.attempt, { recursive: true, force: true });
        }
    }
    async launchEphemeral(state, controlDirectory, entrypoint) {
        const capabilities = await this.inspectCapabilities();
        let runtime;
        try {
            runtime = await this.runtimePrepared(state, controlDirectory, entrypoint, capabilities);
            runtime.prepared.requiresEnvironment = false;
            return await this.spawnPrepared(runtime.prepared);
        }
        finally {
            await this.cleanup();
            if (runtime)
                await rm(runtime.attempt, { recursive: true, force: true });
        }
    }
    async launchAttachedContainer(containerName, directory) {
        invariant(this.provider === 'copilot', 'Attached container launch is Copilot-only', 'PROVIDER_UNKNOWN');
        const command = await this.command();
        const authority = Buffer.from(JSON.stringify({ containerName: `/${containerName}` }), 'utf8').toString('hex');
        const home = join(directory, 'vscode-host-profile');
        await mkdir(home, { recursive: true });
        return waitForProvider(spawn(command.executable, [...command.prefix, '--new-window', '--wait', '--user-data-dir', home, '--folder-uri', `vscode-remote://attached-container+${authority}/workspace`], { env: { ...credentialFreeEnvironment(), ...command.env }, stdio: 'inherit', windowsHide: true, shell: false }));
    }
    async cleanup() { await this.broker?.revoke(); delete this.broker; }
}
export async function withSessionLaunchLock(directory, operation) {
    return withFileLock(join(directory, 'launch.lock'), operation);
}
//# sourceMappingURL=adapters.js.map