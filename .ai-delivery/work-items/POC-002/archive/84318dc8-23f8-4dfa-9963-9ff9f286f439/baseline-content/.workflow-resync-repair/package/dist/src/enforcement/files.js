import { lstat, realpath, readFile, readdir, open, rename, unlink, link, mkdir, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { invariant } from '../shared/errors.js';
import { sha256 } from '../shared/hash.js';
import { checkGovernedPath } from '../governance/scope.js';
const protectedSegments = /^(?:\.git|\.ai-delivery|\.ssh|\.aws|\.azure|\.kube|\.docker|\.codex|\.claude|\.vscode|\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|keystores?|secretstores?|id_rsa|id_ed25519|authorized_keys|known_hosts)$/i;
export function mandatoryRestricted(path) {
    return path.replace(/\\/g, '/').split('/').some((part) => protectedSegments.test(part))
        || /\.(?:pem|key|pfx|p12|crt|cer|jks|keystore|kdbx)$/i.test(path)
        || /(?:^|\/)(?:application_default_credentials\.json|NuGet\.Config|auth\.json|\.github\/hooks)(?:\/|$)/i.test(path.replace(/\\/g, '/'));
}
export function normalizePath(path) {
    invariant(typeof path === 'string' && path.length > 0 && path.length < 4096 && !isAbsolute(path) && !win32.isAbsolute(path), 'Relative path required', 'PATH_INVALID');
    const normalized = path.replace(/\\/g, '/');
    invariant(!/%(?:2e|2f|5c)/i.test(normalized), 'Encoded traversal or separator denied', 'PATH_INVALID');
    invariant(![...normalized].some((character) => character.charCodeAt(0) < 32 || character === ':') && normalized.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'Unsafe path component', 'PATH_INVALID');
    return normalized;
}
export function within(root, target) {
    const rel = relative(resolve(root), resolve(target));
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
/** Reject every link, including Windows junctions, rather than trusting link targets. */
export async function safePath(root, path, missingLeaf = false) {
    const normalized = normalizePath(path);
    const base = await realpath(root);
    invariant(!(await lstat(root)).isSymbolicLink(), 'Linked project root denied', 'PATH_LINK');
    let current = base;
    const parts = normalized.split('/');
    for (let index = 0; index < parts.length; index++) {
        current = join(current, parts[index]);
        try {
            const stat = await lstat(current);
            invariant(!stat.isSymbolicLink() && (!stat.isFile() || stat.nlink <= 1), 'Links/reparse aliases denied', 'PATH_LINK');
            const canonical = await realpath(current);
            invariant(within(base, canonical) && canonical.toLowerCase() === current.toLowerCase(), 'Reparse or path escape denied', 'PATH_ESCAPE');
            invariant(index === parts.length - 1 ? stat.isFile() : stat.isDirectory(), 'Regular file and directory paths required', 'PATH_TYPE');
        }
        catch (error) {
            if (missingLeaf && index === parts.length - 1 && error.code === 'ENOENT')
                return current;
            throw error;
        }
    }
    return current;
}
async function safeCreatePath(root, path) {
    const normalized = normalizePath(path);
    const base = await realpath(root);
    const parts = normalized.split('/');
    let current = base;
    const createdDirectories = [];
    for (const part of parts.slice(0, -1)) {
        current = join(current, part);
        try {
            const info = await lstat(current);
            invariant(info.isDirectory() && !info.isSymbolicLink(), 'Create parent must be a real directory', 'PATH_LINK');
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            await mkdir(current, { mode: 0o700 });
            createdDirectories.push(relative(base, current).replace(/\\/g, '/'));
        }
        const canonical = await realpath(current);
        invariant(within(base, canonical) && canonical.toLowerCase() === current.toLowerCase(), 'Create parent escaped through a reparse point', 'PATH_ESCAPE');
    }
    return { absolute: await safePath(root, normalized, true), createdDirectories };
}
export async function removeCreatedDirectories(root, directories) {
    for (const directory of [...directories].sort((left, right) => right.split('/').length - left.split('/').length)) {
        const absolute = await safePath(root, `${directory}/.placeholder`, true).then((path) => dirname(path));
        await rmdir(absolute).catch((error) => { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT')
            throw error; });
    }
}
export async function listFiles(root) {
    const files = [];
    async function walk(directory, prefix) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (['.git', '.ai-delivery', '.vscode', '.codex', '.claude', '.agents', 'node_modules'].includes(entry.name))
                continue;
            invariant(!entry.isSymbolicLink(), 'Snapshot contains a symbolic link or junction', 'PATH_LINK');
            if (entry.isDirectory())
                await walk(join(directory, entry.name), path);
            else if (entry.isFile())
                files.push(path);
            else
                invariant(false, 'Special file denied', 'PATH_TYPE');
            invariant(files.length <= 100000, 'Workspace file limit exceeded', 'WORKSPACE_LIMIT');
        }
    }
    await walk(root, '');
    return files.sort();
}
export async function snapshot(root) {
    const result = {};
    for (const path of await listFiles(root)) {
        const data = await readFile(await safePath(root, path));
        result[path] = { sha256: sha256(data), size: data.length };
    }
    return result;
}
export function changedPaths(before, after) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path]?.sha256 !== after[path]?.sha256).sort();
}
export function classifiedScope(governance, path) {
    normalizePath(path);
    return !mandatoryRestricted(path) && governance.dataClassification !== 'RESTRICTED' && checkGovernedPath(governance, path).allowed;
}
export class GovernedFiles {
    root;
    constructor(root) {
        this.root = root;
    }
    async read(path) {
        const absolute = await safePath(this.root, path);
        invariant((await lstat(absolute)).size <= 2 * 1024 * 1024, 'File exceeds read limit', 'FILE_TOO_LARGE');
        const data = await readFile(absolute);
        invariant(!data.includes(0), 'Binary read denied', 'FILE_BINARY');
        return { content: data.toString('utf8'), sha256: sha256(data) };
    }
    async mutate(operation, path, expected, content) {
        const target = operation === 'create' ? await safeCreatePath(this.root, path) : { absolute: await safePath(this.root, path), createdDirectories: [] };
        const { absolute, createdDirectories } = target;
        try {
            if (operation === 'create')
                invariant(expected === null, 'Create requires null baseline', 'HASH_REQUIRED');
            else
                invariant(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && sha256(await readFile(absolute)) === expected, 'Optimistic hash mismatch', 'HASH_MISMATCH');
            if (operation === 'delete') {
                await safePath(this.root, path);
                await unlink(absolute);
                return { createdDirectories };
            }
            invariant(typeof content === 'string' && Buffer.byteLength(content) <= 2 * 1024 * 1024, 'Bounded content required', 'CONTENT_INVALID');
            const temporary = join(dirname(absolute), `.ai-delivery-${randomUUID()}.tmp`);
            const handle = await open(temporary, 'wx', 0o600);
            try {
                await handle.writeFile(content, 'utf8');
                await handle.sync();
                await handle.close();
                await safePath(this.root, path, operation === 'create');
                if (operation === 'create')
                    await link(temporary, absolute);
                else {
                    invariant(sha256(await readFile(absolute)) === expected, 'Concurrent file change', 'HASH_MISMATCH');
                    await rename(temporary, absolute);
                }
            }
            finally {
                await handle.close().catch(() => undefined);
                await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT')
                    throw error; });
            }
            return { createdDirectories };
        }
        catch (error) {
            if (operation === 'create')
                await removeCreatedDirectories(this.root, createdDirectories);
            throw error;
        }
    }
}
//# sourceMappingURL=files.js.map