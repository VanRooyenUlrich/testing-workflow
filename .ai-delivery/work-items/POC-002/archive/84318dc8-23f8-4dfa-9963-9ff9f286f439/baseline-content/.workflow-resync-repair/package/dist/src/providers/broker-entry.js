import { readFile } from 'node:fs/promises';
import { startModelBroker } from './broker.js';
import { invariant } from '../shared/errors.js';
async function main() {
    const raw = JSON.parse(await readFile('/broker-secret/config.json', 'utf8'));
    invariant((raw.provider === 'codex' || raw.provider === 'claude') && typeof raw.model === 'string' && typeof raw.upstreamCredential === 'string' && typeof raw.sessionId === 'string' && typeof raw.expiresAt === 'string' && typeof raw.sessionToken === 'string', 'Invalid broker secret file', 'BROKER_CONFIGURATION_INVALID');
    const session = await startModelBroker({ ...raw, auditDirectory: '/tmp/broker-audit', listenHost: '0.0.0.0', port: 8787 });
    process.stdout.write(`${JSON.stringify({ ready: true, expiresAt: session.expiresAt })}\n`);
    const stop = async () => { await session.revoke(); process.exit(0); };
    process.on('SIGTERM', () => { void stop(); });
    process.on('SIGINT', () => { void stop(); });
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
//# sourceMappingURL=broker-entry.js.map