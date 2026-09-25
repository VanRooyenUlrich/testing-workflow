import { readJson } from '../shared/fs.js';
import { invariant } from '../shared/errors.js';
import { parseSessionRecord } from '../schemas/validation.js';
import { ProviderAdapter, providers } from '../providers/adapters.js';
async function main() {
    invariant(process.platform === 'linux', 'Remote provider entry requires Linux', 'ENVIRONMENT_INVALID');
    const provider = process.argv[2];
    invariant(providers.includes(provider), 'Unknown provider', 'PROVIDER_UNKNOWN');
    invariant(process.env.AI_DELIVERY_CONTROLLER_HOST && process.env.AI_DELIVERY_CONTROLLER_TOKEN, 'Remote provider requires the trusted MCP controller', 'MCP_RELAY_CONFIGURATION');
    const state = parseSessionRecord(await readJson('/provider/session.json'));
    invariant(state.runtime === 'CONTAINER' && state.role === 'review' && state.workspace === '/workspace' && state.repository === '/provider/repository', 'Remote review binding is invalid', 'ENVIRONMENT_INVALID');
    process.exitCode = await new ProviderAdapter(provider).launchEphemeral(state, '/provider/control', '/opt/ai-delivery/dist/src/cli/main.js');
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
//# sourceMappingURL=remote-entry.js.map