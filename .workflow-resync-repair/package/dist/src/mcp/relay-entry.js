import { connect } from 'node:net';
import { invariant } from '../shared/errors.js';
const host = process.env.AI_DELIVERY_CONTROLLER_HOST;
const token = process.env.AI_DELIVERY_CONTROLLER_TOKEN;
invariant(host && token, 'Controller host and token are required', 'MCP_RELAY_CONFIGURATION');
const socket = connect({ host, port: 8788 });
socket.once('connect', () => { socket.write(`${JSON.stringify({ token })}\n`); process.stdin.pipe(socket); socket.pipe(process.stdout); });
socket.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
//# sourceMappingURL=relay-entry.js.map