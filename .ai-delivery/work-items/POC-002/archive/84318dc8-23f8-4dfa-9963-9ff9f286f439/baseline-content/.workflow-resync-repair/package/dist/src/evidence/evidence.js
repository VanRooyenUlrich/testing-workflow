import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashObject } from '../shared/hash.js';
import { invariant } from '../shared/errors.js';
import { withFileLock } from '../shared/fs.js';
function eventHash(event) { return hashObject(event); }
export class EvidenceLog {
    path;
    constructor(path) {
        this.path = path;
    }
    async readUnlocked() {
        try {
            const content = await readFile(this.path, 'utf8');
            return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
    }
    async read() { return withFileLock(`${this.path}.lock`, () => this.readUnlocked()); }
    async append(input) {
        return withFileLock(`${this.path}.lock`, async () => {
            const events = await this.readUnlocked();
            this.verifyEvents(events);
            const previous = events.at(-1);
            const unsigned = {
                sequence: events.length + 1, timestamp: input.timestamp, type: input.type,
                ...(input.workItem === undefined ? {} : { workItem: input.workItem }), ...(input.project === undefined ? {} : { project: input.project }),
                ...(input.lifecycleState === undefined ? {} : { lifecycleState: input.lifecycleState }), data: input.data ?? {}, previousHash: previous?.hash ?? null,
            };
            const event = { ...unsigned, hash: eventHash(unsigned) };
            await mkdir(dirname(this.path), { recursive: true });
            await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'a' });
            return event;
        });
    }
    verifyEvents(events) {
        let previousHash = null;
        for (let index = 0; index < events.length; index += 1) {
            const event = events[index];
            invariant(event.sequence === index + 1, `Evidence sequence error at event ${index + 1}`, 'EVIDENCE_ORDER');
            invariant(event.previousHash === previousHash, `Evidence chain error at event ${index + 1}`, 'EVIDENCE_CHAIN');
            const { hash, ...unsigned } = event;
            invariant(hash === eventHash(unsigned), `Evidence tampering detected at event ${index + 1}`, 'EVIDENCE_TAMPERED');
            previousHash = hash;
        }
        return previousHash;
    }
    async verify() {
        return withFileLock(`${this.path}.lock`, async () => {
            const events = await this.readUnlocked();
            return { valid: true, events: events.length, headHash: this.verifyEvents(events) };
        });
    }
}
//# sourceMappingURL=evidence.js.map