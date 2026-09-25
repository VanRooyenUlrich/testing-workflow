import { createServer } from 'node:http';
import { connect } from 'node:net';
const allowed = new Set((process.env.AI_DELIVERY_ALLOWED_DOMAINS ?? '').split(',').filter(Boolean));
function permitted(host) { const value = host.toLowerCase().replace(/\.$/, ''); return allowed.has(value) || [...allowed].some((domain) => value.endsWith(`.${domain}`)); }
const server = createServer((_request, response) => { response.writeHead(405); response.end(); });
server.on('connect', (request, client, head) => {
    const match = /^([^:]+):(\d+)$/.exec(request.url ?? '');
    const host = match?.[1] ?? '';
    const port = Number(match?.[2]);
    if (!permitted(host) || port !== 443 || /^(?:127\.|10\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|::1$|localhost$)/i.test(host)) {
        client.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        client.destroy();
        return;
    }
    const upstream = connect({ host, port }, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length)
        upstream.write(head); upstream.pipe(client); client.pipe(upstream); });
    upstream.once('error', () => { client.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); client.destroy(); });
});
server.listen(8080, '0.0.0.0');
//# sourceMappingURL=proxy-entry.js.map