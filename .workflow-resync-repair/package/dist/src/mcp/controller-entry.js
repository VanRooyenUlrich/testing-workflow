import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { invariant } from '../shared/errors.js';
import { SessionStore } from '../enforcement/session.js';
import { Workflow } from '../work-items/workflow.js';
import { WorkflowRepository } from '../work-items/repository.js';
import { PolicyGateway } from '../enforcement/gateway.js';
import { OpaPolicy } from '../enforcement/policy.js';
import { DeliveryMcpServer } from './server.js';
async function authenticate(socket, token) {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Controller authentication timed out')), 5000);
        const receive = (chunk) => { const end = chunk.indexOf(10); if (end < 0 || end > 4096) {
            clearTimeout(timer);
            reject(new Error('Invalid controller authentication frame'));
            return;
        } try {
            const value = JSON.parse(chunk.subarray(0, end).toString('utf8'));
            invariant(value.token === token, 'Invalid controller token', 'MCP_CONTROLLER_UNAUTHORIZED');
            const remainder = chunk.subarray(end + 1);
            socket.pause();
            socket.off('data', receive);
            if (remainder.length)
                socket.unshift(remainder);
            clearTimeout(timer);
            resolve();
        }
        catch (error) {
            clearTimeout(timer);
            reject(error);
        } };
        socket.on('data', receive);
        socket.once('error', reject);
    });
}
async function main() {
    const token = process.env.AI_DELIVERY_CONTROLLER_TOKEN;
    invariant(token && token.length >= 32, 'Controller token is required', 'MCP_CONTROLLER_CONFIGURATION');
    const store = new SessionStore('/payload/control');
    const state = await store.load();
    invariant(state.runtime === 'CONTAINER', 'Container session required', 'ENVIRONMENT_INVALID');
    const opa = spawn('/usr/local/bin/opa', ['run', '--server', '--addr=127.0.0.1:8181', '/opt/ai-delivery/policy/core.rego'], { stdio: ['ignore', 'ignore', 'inherit'], env: { PATH: '/usr/local/bin:/usr/bin:/bin' } });
    try {
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt += 1) {
            try {
                if ((await fetch('http://127.0.0.1:8181/health', { signal: AbortSignal.timeout(200) })).ok) {
                    ready = true;
                    break;
                }
            }
            catch { /* retry */ }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        invariant(ready, 'OPA failed to start', 'POLICY_UNAVAILABLE');
        const gateway = new PolicyGateway(new Workflow(new WorkflowRepository(state.repository)), store, new OpaPolicy());
        const server = createServer((socket) => { authenticate(socket, token).then(() => { socket.resume(); return new DeliveryMcpServer(gateway).serve(socket, socket); }).then(() => socket.end()).catch(() => socket.destroy()); });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8788, '0.0.0.0', resolve); });
        await new Promise((resolve) => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
        await new Promise((resolve) => server.close(() => resolve()));
    }
    finally {
        opa.kill('SIGTERM');
    }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
//# sourceMappingURL=controller-entry.js.map