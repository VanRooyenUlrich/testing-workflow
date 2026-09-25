import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ContainerRunner, credentialFreeEnvironment, runProcess } from '../enforcement/containers.js';
import { classifiedScope, listFiles, safePath } from '../enforcement/files.js';
import { findProject } from '../projects/projects.js';
import { parseToolchainReceipt } from '../schemas/validation.js';
import { invariant } from '../shared/errors.js';
import { hashObject, sha256 } from '../shared/hash.js';
import { readJson, writeJsonAtomic } from '../shared/fs.js';
import { WorkflowRepository } from '../work-items/repository.js';
const declarations = /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|global\.json|Directory\.(?:Packages\.)?props|Directory\.Build\.targets|[^/]+\.(?:sln|csproj)|packages\.lock\.json)$/i;
function receiptPath(root, project) { return join(root, '.ai-delivery', 'toolchains', `${project}.json`); }
async function inputs(root) { const result = {}; for (const path of await listFiles(root))
    if (declarations.test(path))
        result[path] = sha256(await readFile(await safePath(root, path))); return result; }
function kindFor(command) { return command.executable === 'dotnet' ? 'dotnet' : command.executable === 'bun' ? 'bun' : 'node'; }
async function preparation(kind, source, configured, dependencyPath) {
    const files = new Set(await listFiles(source));
    if (kind === 'dotnet') {
        const rootTargets = [...files].filter((path) => !path.includes('/') && /\.(?:sln|csproj)$/i.test(path));
        const target = files.has('ai-delivery-toolchain.csproj') ? 'ai-delivery-toolchain.csproj' : rootTargets.length === 1 ? rootTargets[0] : undefined;
        invariant(target, 'Dotnet dependency restore requires ai-delivery-toolchain.csproj or exactly one root project or solution', 'TOOLCHAIN_CONFIGURATION_INVALID');
        const restore = JSON.stringify(['dotnet', 'restore', target, '--packages', '/opt/ai-delivery/nuget']);
        return `FROM ${configured} AS prepare\nWORKDIR /prepare\nCOPY . .\nRUN ${restore}\nFROM ${configured}\nUSER 0\nCOPY --from=prepare /opt/ai-delivery/nuget /opt/ai-delivery/nuget\nENV NUGET_PACKAGES=/opt/ai-delivery/nuget\nUSER 65534:65534\n`;
    }
    const install = kind === 'bun' ? 'bun install --frozen-lockfile --ignore-scripts' : files.has('pnpm-lock.yaml') ? 'corepack enable && pnpm install --frozen-lockfile --ignore-scripts' : files.has('yarn.lock') ? 'corepack enable && yarn install --immutable --mode=skip-builds' : 'npm ci --ignore-scripts';
    return `FROM ${configured} AS prepare\nWORKDIR /prepare\nCOPY . .\nRUN ${install}\nFROM ${configured}\nUSER 0\nCOPY --from=prepare /prepare/node_modules ${dependencyPath}\nUSER 65534:65534\n`;
}
export async function prepareToolchain(root, projectId, runner = runProcess, container = new ContainerRunner(runner)) {
    const repository = new WorkflowRepository(root);
    const registry = await repository.loadRegistry();
    const project = findProject(registry, projectId);
    const projectRoot = join(root, project.path === '.' ? '' : project.path);
    const governance = await repository.loadGovernance(projectId);
    const source = await mkdtemp(join(tmpdir(), 'ai-delivery-toolchain-'));
    try {
        for (const path of await listFiles(projectRoot))
            if (classifiedScope(governance, path) && governance.dataClassification !== 'CONFIDENTIAL') {
                const target = join(source, path);
                await mkdir(dirname(target), { recursive: true });
                await writeFile(target, await readFile(await safePath(projectRoot, path)), { flag: 'wx' });
            }
        await writeFile(join(source, '.dockerignore'), '', 'utf8');
        const images = [];
        const combinations = new Map();
        for (const command of Object.values(governance.commands)) {
            const configured = command.isolation?.image;
            if (!configured)
                continue;
            const kind = kindFor(command);
            combinations.set(`${kind}:${configured}`, { configured, kind, dependencyPath: command.isolation?.nodeModulesPath ?? '/opt/ai-delivery/node_modules' });
        }
        for (const { configured, kind, dependencyPath } of combinations.values()) {
            await runner('docker', ['pull', configured], { timeout: 900000, env: credentialFreeEnvironment() });
            const inspected = await runner('docker', ['image', 'inspect', '--format', '{{.Id}}', configured], { timeout: 30000, env: credentialFreeEnvironment() });
            const localId = inspected.stdout.trim();
            invariant(/^sha256:[a-f0-9]{64}$/.test(localId), 'Docker returned an invalid image identity', 'TOOLCHAIN_IMAGE_INVALID');
            const dockerfile = join(source, `.ai-delivery-${kind}.Dockerfile`);
            await writeFile(dockerfile, await preparation(kind, source, configured, dependencyPath));
            const tag = `ai-delivery-prepared-${hashObject({ projectId, configured, kind, inputs: await inputs(projectRoot) }).slice(0, 24)}`;
            await runner('docker', ['build', '--network=default', '--file', dockerfile, '--tag', tag, source], { timeout: 1800000, env: credentialFreeEnvironment() });
            const prepared = await runner('docker', ['image', 'inspect', '--format', '{{.Id}}', tag], { timeout: 30000, env: credentialFreeEnvironment() });
            const preparedId = prepared.stdout.trim();
            invariant(/^sha256:[a-f0-9]{64}$/.test(preparedId), 'Prepared toolchain image identity is invalid', 'TOOLCHAIN_IMAGE_INVALID');
            images.push({ configured, localId, preparedId, kind });
        }
        const commands = [];
        for (const [id, definition] of Object.entries(governance.commands).sort(([left], [right]) => left.localeCompare(right))) {
            const image = images.find((entry) => entry.configured === definition.isolation?.image && entry.kind === kindFor(definition));
            invariant(image && definition.isolation, `Prepared image missing for ${id}`, 'TOOLCHAIN_IMAGE_INVALID');
            const preparedDefinition = { ...definition, isolation: { ...definition.isolation, image: image.preparedId, ...(image.kind === 'node' || image.kind === 'bun' ? { nodeModulesPath: definition.isolation.nodeModulesPath ?? '/opt/ai-delivery/node_modules' } : {}) } };
            const result = await container.execute(preparedDefinition, source);
            commands.push({ id, definitionHash: hashObject(definition), outputHash: result.outputHash, runtimeImage: image.preparedId });
        }
        const receipt = { schemaVersion: 1, project: projectId, preparedAt: new Date().toISOString(), inputs: await inputs(projectRoot), images, commands };
        parseToolchainReceipt(receipt);
        await writeJsonAtomic(receiptPath(root, projectId), receipt);
        return receipt;
    }
    finally {
        await rm(source, { recursive: true, force: true }).catch(() => undefined);
    }
}
export async function verifyToolchain(root, projectId, runner = runProcess) {
    const receipt = parseToolchainReceipt(await readJson(receiptPath(root, projectId)));
    const registry = await new WorkflowRepository(root).loadRegistry();
    const projectRoot = join(root, findProject(registry, projectId).path);
    invariant(receipt.project === projectId && hashObject(receipt.inputs) === hashObject(await inputs(projectRoot)), 'Project declarations changed; prepare the toolchain again', 'TOOLCHAIN_STALE');
    for (const image of receipt.images) {
        const result = await runner('docker', ['image', 'inspect', '--format', '{{.Id}}', image.configured], { timeout: 30000, env: credentialFreeEnvironment() });
        invariant(result.stdout.trim() === image.localId, `Prepared base image changed: ${image.configured}`, 'TOOLCHAIN_STALE');
        const prepared = await runner('docker', ['image', 'inspect', '--format', '{{.Id}}', image.preparedId], { timeout: 30000, env: credentialFreeEnvironment() });
        invariant(prepared.stdout.trim() === image.preparedId, `Prepared dependency image is missing: ${image.preparedId}`, 'TOOLCHAIN_STALE');
    }
    return { ready: true, receipt };
}
export async function resolvePreparedCommand(root, projectId, id, definition, runner = runProcess) {
    const { receipt } = await verifyToolchain(root, projectId, runner);
    const command = receipt.commands.find((entry) => entry.id === id);
    invariant(command?.definitionHash === hashObject(definition) && definition.isolation, `Prepared command is stale: ${id}`, 'TOOLCHAIN_STALE');
    const kind = kindFor(definition);
    return { ...definition, isolation: { ...definition.isolation, image: command.runtimeImage, ...(kind === 'node' || kind === 'bun' ? { nodeModulesPath: definition.isolation.nodeModulesPath ?? '/opt/ai-delivery/node_modules' } : {}) } };
}
//# sourceMappingURL=toolchain.js.map
