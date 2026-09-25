import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requirePinnedImage } from '../shared/images.js';
import { invariant } from '../shared/errors.js';
import { GitInspector } from '../git/git-inspector.js';
const execFileAsync = promisify(execFile);
async function exists(path) { try {
    await access(path, constants.F_OK);
    return true;
}
catch {
    return false;
} }
export function validateToolchainConfiguration(toolchains) {
    invariant(Object.keys(toolchains).every((kind) => ['node', 'bun', 'dotnet'].includes(kind)), 'Unknown toolchain configuration', 'INIT_TOOLCHAIN_INVALID');
    for (const [kind, toolchain] of Object.entries(toolchains)) {
        invariant(typeof toolchain === 'object' && toolchain !== null && Object.keys(toolchain).every((key) => ['image', 'nodeModulesPath'].includes(key)), `Invalid ${kind} toolchain configuration`, 'INIT_TOOLCHAIN_INVALID');
        requirePinnedImage(toolchain.image);
        invariant(toolchain.nodeModulesPath === undefined || kind === 'node' && /^\/opt\/[a-z0-9._/-]+\/node_modules$/.test(toolchain.nodeModulesPath), 'Node modules path must be an absolute /opt/.../node_modules path on the Node toolchain', 'COMMAND_ISOLATION_INVALID');
    }
}
async function packageScripts(root) {
    try {
        const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
        return parsed.scripts ?? {};
    }
    catch {
        return {};
    }
}
function toolchainFor(executable) {
    if (executable === 'dotnet')
        return 'dotnet';
    if (executable === 'bun')
        return 'bun';
    return 'node';
}
export function requiredToolchains(commands) {
    return [...new Set(Object.values(commands).map((command) => toolchainFor(command.executable)))];
}
function isolated(command, toolchains) {
    const kind = toolchainFor(command.executable);
    const toolchain = toolchains[kind];
    if (!toolchain)
        return command;
    return {
        ...command,
        isolation: {
            workingDirectory: '.', image: toolchain.image, timeoutMs: 900_000, cpus: 2, memoryMb: 2048, pids: 256,
            network: 'none', allowedDomains: [], requiredForReview: true,
            ...(kind === 'node' && toolchain.nodeModulesPath !== undefined ? { nodeModulesPath: toolchain.nodeModulesPath } : {}),
        },
    };
}
function scriptCommand(manager, name, toolchains) {
    return isolated({ executable: manager === 'unknown' ? 'npm' : manager, args: ['run', name] }, toolchains);
}
export async function detectCommands(directory, detectedManager, toolchains = {}) {
    validateToolchainConfiguration(toolchains);
    let manager = detectedManager;
    if (await exists(join(directory, 'pnpm-lock.yaml')))
        manager = 'pnpm';
    else if (await exists(join(directory, 'yarn.lock')))
        manager = 'yarn';
    else if (await exists(join(directory, 'bun.lockb')) || await exists(join(directory, 'bun.lock')))
        manager = 'bun';
    else if (await exists(join(directory, 'package.json')))
        manager = 'npm';
    const scripts = await packageScripts(directory);
    const commands = {};
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const dotnet = entries.some((entry) => entry.isFile() && /\.(sln|csproj)$/i.test(entry.name));
    const node = Object.keys(scripts).some((name) => ['build', 'test', 'lint'].includes(name));
    for (const name of ['build', 'test', 'lint'])
        if (scripts[name])
            commands[dotnet && node ? `node:${name}` : name] = scriptCommand(manager, name, toolchains);
    if (dotnet) {
        commands[node ? 'dotnet:build' : 'build'] = isolated({ executable: 'dotnet', args: ['build'] }, toolchains);
        commands[node ? 'dotnet:test' : 'test'] = isolated({ executable: 'dotnet', args: ['test'] }, toolchains);
    }
    return commands;
}
export async function detectProject(cwd, toolchains = {}) {
    const gitRoot = await new GitInspector(cwd).repositoryRoot();
    const lockManagers = [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']];
    let packageManager = 'unknown';
    for (const [lock, manager] of lockManagers)
        if (await exists(join(gitRoot, lock))) {
            packageManager = manager;
            break;
        }
    const rootEntries = await readdir(gitRoot, { withFileTypes: true });
    const rootDotnet = rootEntries.some((entry) => entry.isFile() && /\.(sln|csproj)$/i.test(entry.name));
    if (packageManager === 'unknown' && await exists(join(gitRoot, 'package.json')))
        packageManager = 'npm';
    if (packageManager === 'unknown' && rootDotnet)
        packageManager = 'dotnet';
    const candidates = [];
    if (await exists(join(gitRoot, 'package.json')) || rootDotnet)
        candidates.push('.');
    for (const entry of rootEntries.filter((item) => item.isDirectory() && !item.name.startsWith('.'))) {
        const child = join(gitRoot, entry.name);
        const children = await readdir(child, { withFileTypes: true }).catch(() => []);
        if (children.some((item) => item.name === 'package.json' || /\.csproj$/i.test(item.name)))
            candidates.push(entry.name);
    }
    const commands = await detectCommands(gitRoot, packageManager, toolchains);
    const applicationCommands = {};
    for (const candidate of candidates)
        applicationCommands[candidate] = await detectCommands(join(gitRoot, candidate === '.' ? '' : candidate), packageManager, toolchains);
    let dotnetVersion = null;
    try {
        dotnetVersion = (await execFileAsync('dotnet', ['--version'], { encoding: 'utf8', windowsHide: true })).stdout.trim();
    }
    catch { /* optional */ }
    const paths = rootEntries.map((entry) => join(gitRoot, entry.name));
    const existing = {
        agents: (await Promise.all([join(gitRoot, 'AGENTS.md'), ...candidates.filter((item) => item !== '.').map((item) => join(gitRoot, item, 'AGENTS.md'))].map(async (path) => await exists(path) ? relative(gitRoot, path) : null))).filter((path) => path !== null),
        aiDelivery: (await Promise.all([join(gitRoot, '.ai-delivery'), ...candidates.filter((item) => item !== '.').map((item) => join(gitRoot, item, '.ai-delivery'))].map(async (path) => await exists(path) ? relative(gitRoot, path) : null))).filter((path) => path !== null),
        skills: (await Promise.all(['.agents/skills', '.codex/skills', '.claude/skills'].map(async (path) => await exists(join(gitRoot, path)) ? path : null))).filter((path) => path !== null),
        ideOrMcp: (await Promise.all(['.vscode/settings.json', '.vscode/mcp.json', '.vscode/ai-delivery-hooks.json', '.mcp.json', '.cursor/mcp.json', '.codex/config.toml', '.claude/settings.json', '.github/hooks/ai-delivery.json'].map(async (path) => await exists(join(gitRoot, path)) ? path : null))).filter((path) => path !== null),
    };
    void paths;
    return { gitRoot, packageManager, nodeVersion: process.version, dotnetVersion, candidateApplications: candidates.sort(), commands, applicationCommands, existing };
}
//# sourceMappingURL=detection.js.map