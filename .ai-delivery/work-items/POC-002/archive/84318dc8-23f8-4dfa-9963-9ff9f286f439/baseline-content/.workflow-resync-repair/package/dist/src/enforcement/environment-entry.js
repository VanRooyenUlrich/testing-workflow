import { spawn } from 'node:child_process';
import { SessionStore } from './session.js';
import { ProviderAdapter, providers } from '../providers/adapters.js';
import { invariant } from '../shared/errors.js';
import { Workflow } from '../work-items/workflow.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { PolicyGateway } from './gateway.js';
import { OpaPolicy } from './policy.js';
import { DeliveryMcpServer } from '../mcp/server.js';
async function main() {
    invariant(process.platform === 'linux', 'Container entry requires Linux', 'ENVIRONMENT_INVALID');
    const provider = process.argv[2];
    invariant(providers.includes(provider), 'Unknown provider', 'PROVIDER_UNKNOWN');
    const store = new SessionStore('/payload/control');
    const state = await store.load();
    invariant(state.runtime === 'CONTAINER' && state.workspace === '/payload/workspace' && state.repository === '/payload/control/repository', 'Invalid isolated runtime binding', 'ENVIRONMENT_INVALID');
    const opa = spawn('/usr/local/bin/opa', ['run', '--server', '--addr=127.0.0.1:8181', '/opt/ai-delivery/policy/core.rego'], { stdio: ['ignore', 'ignore', 'inherit'], env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    let failure;
    opa.once('error', (error) => { failure = error; });
    try {
        for (let attempt = 0; attempt < 50; attempt++) {
            if (failure)
                throw failure;
            try {
                const response = await fetch('http://127.0.0.1:8181/health', { signal: AbortSignal.timeout(200) });
                if (response.ok)
                    break;
            }
            catch { /* bounded startup retry */ }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const workflow = new Workflow(new WorkflowRepository(state.repository));
        const gateway = new PolicyGateway(workflow, store, new OpaPolicy());
        await gateway.authorize('tool.invoke');
        if (provider === 'generic-mcp') {
            await new DeliveryMcpServer(gateway).serve(process.stdin, process.stdout);
            return;
        }
        process.exitCode = await new ProviderAdapter(provider).launchEphemeral(state, '/payload/control', '/opt/ai-delivery/dist/src/cli/main.js');
    }
    finally {
        opa.kill('SIGTERM');
    }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
//# sourceMappingURL=environment-entry.js.map