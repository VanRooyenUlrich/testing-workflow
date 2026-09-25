import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { hashObject } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { SessionStore } from './session.js';
export async function inspectPrune(root, now = Date.now()) {
    const threshold = now - 7 * 24 * 60 * 60 * 1000;
    const entries = [];
    let directories = [];
    try {
        directories = await readdir(tmpdir());
    }
    catch { /* Empty plan. */ }
    for (const name of directories.filter((entry) => entry.startsWith('ai-delivery-session-'))) {
        const directory = join(tmpdir(), name);
        try {
            const state = await new SessionStore(directory).read();
            const closedAt = state.revokedAt ?? state.expiresAt;
            if (resolve(state.repository) === resolve(root) && state.closed && Date.parse(closedAt) < threshold && (state.mode === 'HOST_WORKSPACE' || state.promotion?.applied))
                entries.push({ directory, sessionId: state.id, workItem: state.workItem, closedAt });
        }
        catch { /* Never prune an unreadable directory. */ }
    }
    const unsigned = { root, olderThan: new Date(threshold).toISOString(), entries: entries.sort((a, b) => a.directory.localeCompare(b.directory)) };
    return { ...unsigned, planHash: hashObject(unsigned) };
}
export async function applyPrune(root, planHash) { const plan = await inspectPrune(root); invariant(plan.planHash === planHash, 'Prune plan changed after review', 'PRUNE_PLAN_STALE'); for (const entry of plan.entries)
    await rm(entry.directory, { recursive: true }); return inspectPrune(root); }
//# sourceMappingURL=prune.js.map