import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { invariant } from '../shared/errors.js';
async function exchange(entrypoint, session, call) {
    const child = spawn(process.execPath, [entrypoint, 'mcp', 'serve', '--session', session], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map();
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    lines.on('line', (line) => { try {
        const response = JSON.parse(line);
        if (typeof response.id === 'number') {
            const request = pending.get(response.id);
            if (request) {
                pending.delete(response.id);
                request.resolve(response);
            }
        }
    }
    catch { /* Ignore non-protocol provider diagnostics. */ } });
    child.once('error', (error) => { for (const request of pending.values())
        request.reject(error); pending.clear(); });
    let sequence = 0;
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
    });
    try {
        const initialized = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ai-delivery-reference', version: '1.0.0' } });
        invariant(!initialized.error && typeof initialized.result === 'object' && initialized.result !== null, `MCP initialization failed: ${stderr}`, 'MCP_REFERENCE_FAILED');
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const listed = await request('tools/list');
        const listResult = listed.result;
        invariant(!listed.error && Array.isArray(listResult?.tools), 'MCP tool discovery failed', 'MCP_REFERENCE_FAILED');
        const result = initialized.result;
        const tools = listResult.tools.map((tool) => tool.name).filter((name) => typeof name === 'string');
        let callResult;
        if (call) {
            const response = await request('tools/call', { name: call.name, arguments: call.arguments });
            invariant(!response.error, 'MCP tool call failed', 'MCP_REFERENCE_FAILED');
            callResult = response.result;
        }
        return { protocolVersion: String(result.protocolVersion), tools, ...(call === undefined ? {} : { call: callResult }) };
    }
    finally {
        child.stdin.end();
        child.kill('SIGTERM');
        lines.close();
    }
}
export async function runReferenceClient(entrypoint, session, options = {}) {
    const first = await exchange(entrypoint, session, options.call);
    let reconnects = 0;
    if (options.reconnect) {
        await exchange(entrypoint, session);
        reconnects = 1;
    }
    return { ...first, reconnects };
}
//# sourceMappingURL=reference-client.js.map