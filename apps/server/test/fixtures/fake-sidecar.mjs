// Stand-in for the Python AI sidecar (same line protocol), used by ai.test.mjs.
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
const send = m => process.stdout.write(`${JSON.stringify(m)}\n`);
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'shutdown') process.exit(0);
  if (msg.method === 'crash') process.exit(3);
  if (msg.method === 'slow') return;
  if (msg.method === 'delay')
    return void setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { method: 'delay' } }), msg.params.ms);
  if (msg.method === 'fail')
    return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'x', data: { kind: 'unreachable' } } });
  send({
    jsonrpc: '2.0',
    id: msg.id,
    result: { method: msg.method, params: msg.params, env: Object.keys(process.env) }
  });
});
