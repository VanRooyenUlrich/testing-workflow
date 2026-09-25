import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { invariant } from './errors.js';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
/**
 * Runs an operation while holding an atomic, cross-process lock file. Lock files
 * are deliberately not stolen: an interrupted operation must be investigated
 * before its state is changed again.
 */
export async function withFileLock(path, operation, options = {}) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const retryMs = options.retryMs ?? 20;
    const startedAt = Date.now();
    const token = randomUUID();
    await mkdir(dirname(path), { recursive: true });
    let handle;
    for (;;) {
        try {
            handle = await open(path, 'wx', 0o600);
            break;
        }
        catch (error) {
            const code = error.code;
            // Windows can report EPERM while another process is deleting the lock;
            // treat that transient state as contention even if the follow-up stat races.
            const contended = code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' && await stat(path).then(() => true).catch(() => false);
            if (!contended)
                throw error;
            invariant(Date.now() - startedAt < timeoutMs, `Timed out waiting for filesystem lock: ${path}`, 'FILESYSTEM_LOCK_TIMEOUT');
            await delay(retryMs);
        }
    }
    try {
        await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
        await handle.sync();
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(path).catch(() => undefined);
        throw error;
    }
    try {
        return await operation();
    }
    finally {
        await handle.close();
        const owner = await readFile(path, 'utf8').then((value) => JSON.parse(value)).catch(() => undefined);
        if (owner?.token === token)
            await unlink(path).catch(() => undefined);
    }
}
export async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, path);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
export async function writeTextAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, path);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
//# sourceMappingURL=fs.js.map