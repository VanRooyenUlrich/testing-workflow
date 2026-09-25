import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { classifiedScope, listFiles, normalizePath, safePath, snapshot } from './files.js';
import { checkDrift } from './session.js';
import { requirePinnedImage } from '../shared/images.js';
export { requirePinnedImage } from '../shared/images.js';
const exec = promisify(execFile);
export const runProcess = async (executable, args, options) => exec(executable, args, { ...options, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
export function credentialFreeEnvironment(source = process.env) {
    const result = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'])
        if (source[key])
            result[key] = source[key];
    return result;
}
export function domainAllowed(domain, allowed) {
    return /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(domain) && allowed.some((entry) => entry === domain);
}
export function validateCommand(command) {
    const isolation = command.isolation;
    invariant(isolation, 'Legacy command lacks isolation definition; execution denied', 'COMMAND_ISOLATION_REQUIRED');
    requirePinnedImage(isolation.image);
    invariant(typeof command.executable === 'string' && command.executable.length > 0 && !command.executable.startsWith('-') && ![...command.executable].some((character) => character.charCodeAt(0) < 32) && Array.isArray(command.args) && command.args.every((arg) => typeof arg === 'string' && !arg.includes('\0')), 'Invalid fixed executable', 'COMMAND_INVALID');
    if (isolation.workingDirectory !== '.')
        normalizePath(isolation.workingDirectory);
    invariant(isolation.timeoutMs >= 1 && isolation.timeoutMs <= 3600000 && isolation.cpus > 0 && isolation.cpus <= 16 && Number.isInteger(isolation.memoryMb) && isolation.memoryMb >= 16 && isolation.memoryMb <= 32768 && Number.isInteger(isolation.pids) && isolation.pids > 0 && isolation.pids <= 4096, 'Command resource limits invalid', 'COMMAND_LIMITS_INVALID');
    invariant(isolation.network === 'none' || isolation.network === 'proxy', 'Unknown network mode', 'NETWORK_DENIED');
    invariant(isolation.allowedDomains.every((domain) => domainAllowed(domain, isolation.allowedDomains)), 'Invalid domain allowlist', 'NETWORK_DENIED');
    invariant(isolation.network !== 'none' || isolation.allowedDomains.length === 0, 'Network-none command cannot have domains', 'NETWORK_DENIED');
    invariant(isolation.nodeModulesPath === undefined || /^\/opt\/[a-z0-9._/-]+\/node_modules$/.test(isolation.nodeModulesPath), 'Unsafe toolchain node_modules path', 'COMMAND_ISOLATION_INVALID');
    return isolation;
}
/** A Docker volume is seeded by a stopped helper, never by a writable host bind. */
export class ContainerRunner {
    runner;
    requiresPreparedToolchain;
    constructor(runner = runProcess) {
        this.runner = runner;
        this.requiresPreparedToolchain = runner === runProcess;
    }
    async docker(args, timeout = 30000) {
        return this.runner('docker', args, { timeout, env: credentialFreeEnvironment() });
    }
    async execute(command, source) {
        const config = validateCommand(command);
        // Domain matching alone is not a network boundary. Until a verified egress proxy is configured, fail closed.
        invariant(config.network === 'none', 'Controlled egress proxy is not provisioned; networked command denied', 'NETWORK_PROXY_UNAVAILABLE');
        const name = `ai-delivery-${randomUUID()}`;
        const volume = `${name}-source`;
        const seed = `${name}-seed`;
        await this.docker(['volume', 'create', volume]);
        try {
            await this.docker(['create', '--name', seed, '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--mount', `type=volume,source=${volume},target=/workspace`, config.image]);
            await this.docker(['cp', `${source}/.`, `${seed}:/workspace`]);
            // Tool output stays inside the disposable volume; the source checkout is
            // never mounted and the governed command still runs unprivileged.
            await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--user', '0:0', '--mount', `type=volume,source=${volume},target=/workspace`, '--entrypoint', '/bin/chown', config.image, '-R', '65534:65534', '/workspace']);
            if (config.nodeModulesPath)
                await this.docker(['run', '--rm', '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65534:65534', '--mount', `type=volume,source=${volume},target=/workspace`, '--entrypoint', '/bin/ln', config.image, '-s', config.nodeModulesPath, '/workspace/node_modules']);
            const args = ['run', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--network=none', '--cpus', String(config.cpus), '--memory', `${config.memoryMb}m`, '--memory-swap', `${config.memoryMb}m`, '--pids-limit', String(config.pids), '--user', '65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m', '--mount', `type=volume,source=${volume},target=/workspace`, '--workdir', config.workingDirectory === '.' ? '/workspace' : `/workspace/${config.workingDirectory}`, '--env', 'HOME=/tmp', '--entrypoint', command.executable, config.image, ...command.args];
            const result = await this.docker(args, config.timeoutMs);
            return { exitCode: 0, outputHash: hashObject(result), stdout: result.stdout, stderr: result.stderr };
        }
        finally {
            // Kill the container even when the client timeout only killed docker.exe.
            await this.docker(['rm', '-f', name]).catch(() => undefined);
            await this.docker(['rm', '-f', seed]).catch(() => undefined);
            await this.docker(['volume', 'rm', volume]).catch(() => undefined);
        }
    }
}
const MAX_LOG_BYTES = 1024 * 1024;
function bounded(value) { return Buffer.from(value).subarray(0, MAX_LOG_BYTES).toString('utf8'); }
function redact(value) {
    let result = value;
    for (const [name, secret] of Object.entries(process.env))
        if (/(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION)/i.test(name) && secret && secret.length >= 4)
            result = result.split(secret).join('[REDACTED]');
    return result.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]');
}
function failureDetails(error) {
    const record = error;
    const timedOut = record.killed === true || record.code === 'ETIMEDOUT';
    const cancelled = record.signal === 'SIGINT' || record.signal === 'SIGTERM';
    return {
        status: timedOut ? 'TIMED_OUT' : cancelled ? 'CANCELLED' : 'FAILED',
        exitCode: typeof record.code === 'number' ? record.code : null,
        stdout: typeof record.stdout === 'string' ? record.stdout : '',
        stderr: typeof record.stderr === 'string' ? record.stderr : String(record.message ?? error),
    };
}
async function writeCommandLog(gateway, command, receiptId, content) {
    const directory = join(gateway.store.directory, 'logs');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const logPath = `logs/${command.replace(/[^a-zA-Z0-9_.-]/g, '_')}-${receiptId}.log`;
    const bytes = bounded(redact(content));
    const absolute = join(gateway.store.directory, logPath);
    await writeFile(absolute, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(absolute, 0o600).catch(() => undefined);
    return { logPath, logHash: sha256(bytes) };
}
export async function runGovernedCommand(gateway, request, runner = new ContainerRunner()) {
    invariant(typeof request === 'object' && request !== null && !Array.isArray(request), 'Command object required', 'COMMAND_INVALID');
    const input = request;
    invariant(Object.keys(input).length === 1 && typeof input.id === 'string', 'Only fixed command id accepted; arguments forbidden', 'COMMAND_ARGUMENTS_DENIED');
    return gateway.store.exclusive(async () => {
        const state = await gateway.current();
        await checkDrift(gateway.workflow, gateway.store, state);
        await gateway.authorize('command.execute', { command: input.id });
        const governance = await gateway.workflow.repository.loadGovernance(state.project);
        const configured = governance.commands[input.id];
        invariant(configured, 'Unknown command identifier', 'COMMAND_UNKNOWN');
        const definition = runner instanceof ContainerRunner && runner.requiresPreparedToolchain ? await import('../config/toolchain.js').then(({ resolvePreparedCommand }) => resolvePreparedCommand(gateway.workflow.repository.gitRoot, state.project, input.id, configured)) : configured;
        const configuredDefinitionHash = hashObject(configured);
        validateCommand(definition);
        const source = await mkdtemp(join(tmpdir(), 'ai-delivery-command-'));
        const before = hashObject(await snapshot(state.workspace));
        for (const path of await listFiles(state.workspace)) {
            if (!classifiedScope(governance, path) || governance.dataClassification === 'CONFIDENTIAL')
                continue;
            // Filtering uses precisely the same work-specific data boundary as MCP reads.
            try {
                await gateway.authorize('file.read', { path });
            }
            catch {
                continue;
            }
            const destination = join(source, path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, await readFile(await safePath(state.workspace, path)), { flag: 'wx', mode: 0o666 });
        }
        invariant(hashObject(await snapshot(state.workspace)) === before, 'Source changed during command snapshot', 'WORKSPACE_DRIFT');
        const command = input.id;
        const receiptId = randomUUID();
        const startedAt = new Date().toISOString();
        await gateway.audit('COMMAND_STARTED', { command, snapshotHash: before, receipt: receiptId, definitionHash: configuredDefinitionHash });
        try {
            const result = await runner.execute(definition, source);
            await checkDrift(gateway.workflow, gateway.store, state);
            invariant(hashObject(await snapshot(state.workspace)) === before, 'Workspace changed during validation', 'WORKSPACE_DRIFT');
            const sameSnapshot = state.validation?.snapshotHash === before;
            const commands = sameSnapshot ? state.validation.commands : [];
            const previousResults = sameSnapshot ? state.validation.commandResults ?? [] : [];
            const completedAt = new Date().toISOString();
            const log = await writeCommandLog(gateway, command, receiptId, `stdout:\n${result.stdout}\n\nstderr:\n${result.stderr}\n`);
            const receipt = { id: receiptId, command, status: 'PASSED', exitCode: result.exitCode, definitionHash: configuredDefinitionHash, outputHash: result.outputHash, ...log, startedAt, completedAt, sessionId: state.id, snapshotHash: before, governanceHash: state.governanceHash, manifestHash: state.manifestHash };
            const commandResults = [...previousResults, receipt];
            state.validation = { snapshotHash: before, governanceHash: state.governanceHash, passed: false, commands: [...new Set([...commands, command])], commandResults };
            await gateway.store.save(state);
            await gateway.audit('COMMAND_PASSED', { command, receipt: receiptId, outputHash: result.outputHash, logHash: log.logHash, snapshotHash: before, governanceHash: state.governanceHash, manifestHash: state.manifestHash, completedAt });
            return result;
        }
        catch (error) {
            const failure = failureDetails(error);
            const completedAt = new Date().toISOString();
            const log = await writeCommandLog(gateway, command, receiptId, `stdout:\n${failure.stdout}\n\nstderr:\n${failure.stderr}\n`);
            const sameSnapshot = state.validation?.snapshotHash === before;
            const prior = sameSnapshot ? state.validation?.commandResults ?? [] : [];
            const passed = sameSnapshot ? state.validation?.commands ?? [] : [];
            const receipt = { id: receiptId, command, status: failure.status, exitCode: failure.exitCode, definitionHash: configuredDefinitionHash, outputHash: sha256(`${failure.stdout}\n${failure.stderr}`), ...log, startedAt, completedAt, sessionId: state.id, snapshotHash: before, governanceHash: state.governanceHash, manifestHash: state.manifestHash };
            state.validation = { snapshotHash: before, governanceHash: state.governanceHash, passed: false, commands: passed.filter((id) => id !== command), commandResults: [...prior, receipt] };
            await gateway.store.save(state);
            await gateway.audit('COMMAND_FAILED', { command, receipt: receiptId, status: failure.status, exitCode: failure.exitCode ?? -1, outputHash: receipt.outputHash, logHash: log.logHash });
            throw error;
        }
        finally {
            await rm(source, { recursive: true, force: true }).catch(() => undefined);
        }
    });
}
