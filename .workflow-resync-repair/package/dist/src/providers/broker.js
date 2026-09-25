import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { invariant } from '../shared/errors.js';
import { hashObject } from '../shared/hash.js';
async function body(request) { const chunks = []; let size = 0; for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    invariant(size <= 10 * 1024 * 1024, 'Broker request exceeds limit', 'BROKER_REQUEST_LIMIT');
    chunks.push(bytes);
} return Buffer.concat(chunks); }
function bearer(request) { const value = request.headers.authorization ?? ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function allowedPath(provider, method, path) { return provider === 'codex' ? method === 'POST' && path === '/v1/responses' : method === 'POST' && (path === '/v1/messages' || path === '/v1/messages/count_tokens') || method === 'GET' && path === '/v1/models'; }
export async function startModelBroker(options) {
    invariant(options.model.length > 0 && Date.parse(options.expiresAt) > Date.now(), 'Broker model and future expiry are required', 'BROKER_CONFIGURATION_INVALID');
    const token = options.sessionToken ?? randomBytes(32).toString('base64url');
    let revoked = false;
    const fetcher = options.fetcher ?? fetch;
    await mkdir(options.auditDirectory, { recursive: true, mode: 0o700 });
    const auditPath = join(options.auditDirectory, 'broker-audit.jsonl');
    const audit = async (data) => appendFile(auditPath, `${JSON.stringify({ timestamp: new Date().toISOString(), provider: options.provider, sessionId: options.sessionId, ...data })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    const handle = async (request, response) => {
        const requestId = randomUUID();
        const started = Date.now();
        const abort = new AbortController();
        request.once('aborted', () => abort.abort());
        try {
            invariant(!revoked && Date.parse(options.expiresAt) > Date.now() && bearer(request) === token, 'Broker token is invalid, expired, or revoked', 'BROKER_UNAUTHORIZED');
            const method = request.method ?? '';
            const path = new URL(request.url ?? '/', 'http://broker.invalid').pathname;
            if (method === 'GET' && path === '/health') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end('{"ready":true}');
                return;
            }
            invariant(allowedPath(options.provider, method, path), 'Broker endpoint denied', 'BROKER_ENDPOINT_DENIED');
            if (options.provider === 'claude' && method === 'GET') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ data: [{ id: options.model, display_name: options.model, type: 'model' }] }));
                await audit({ requestId, method, path, status: 200, durationMs: Date.now() - started });
                return;
            }
            const bytes = await body(request);
            const json = JSON.parse(bytes.toString('utf8'));
            invariant(json.model === options.model, 'Requested model is outside the session allowance', 'BROKER_MODEL_DENIED');
            const upstream = options.upstreamBaseUrl ?? (options.provider === 'codex' ? 'https://api.openai.com' : 'https://api.anthropic.com');
            const headers = new Headers();
            for (const [name, value] of Object.entries(request.headers))
                if (typeof value === 'string' && ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'x-request-id'].includes(name))
                    headers.set(name, value);
            if (options.provider === 'codex')
                headers.set('authorization', `Bearer ${options.upstreamCredential}`);
            else
                headers.set('x-api-key', options.upstreamCredential);
            let upstreamResponse;
            for (let attempt = 0; attempt < 3; attempt += 1) {
                upstreamResponse = await fetcher(`${upstream}${path}`, { method, headers, body: bytes, signal: abort.signal });
                if (![429, 502, 503].includes(upstreamResponse.status) || attempt === 2)
                    break;
                await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * (attempt + 1), 2000)));
            }
            invariant(upstreamResponse, 'Broker received no upstream response', 'BROKER_UPSTREAM_FAILED');
            const outputHeaders = {};
            for (const name of ['content-type', 'request-id', 'x-request-id']) {
                const value = upstreamResponse.headers.get(name);
                if (value)
                    outputHeaders[name] = value;
            }
            response.writeHead(upstreamResponse.status, outputHeaders);
            if (upstreamResponse.body)
                for await (const chunk of upstreamResponse.body)
                    response.write(chunk);
            response.end();
            await audit({ requestId, method, path, modelHash: hashObject(options.model), status: upstreamResponse.status, durationMs: Date.now() - started });
        }
        catch (error) {
            const code = error.code ?? 'BROKER_ERROR';
            if (!response.headersSent)
                response.writeHead(code === 'BROKER_UNAUTHORIZED' ? 401 : 403, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: { code } }));
            await audit({ requestId, status: response.statusCode, errorCode: code, durationMs: Date.now() - started });
        }
    };
    const server = createServer((request, response) => { void handle(request, response); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, options.listenHost ?? '127.0.0.1', resolve); });
    const address = server.address();
    invariant(address && typeof address === 'object', 'Broker failed to bind', 'BROKER_START_FAILED');
    await audit({ event: 'TOKEN_ISSUED', expiresAt: options.expiresAt, modelHash: hashObject(options.model) });
    return { baseUrl: `http://${options.listenHost ?? '127.0.0.1'}:${address.port}`, token, expiresAt: options.expiresAt, revoke: async () => { if (revoked)
            return; revoked = true; await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await audit({ event: 'TOKEN_REVOKED' }); } };
}
//# sourceMappingURL=broker.js.map