// Stands in for the bundled Ollama binary in tests: `serve` listens on OLLAMA_HOST and writes the
// environment it got into $HOME/env.json, so the test can check the isolation.
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'serve') process.exit(2);
writeFileSync(path.join(process.env.HOME, 'env.json'), JSON.stringify(process.env));
const [host, port] = String(process.env.OLLAMA_HOST).split(':');
http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0.0-test' }));
    res.statusCode = 404;
    res.end('{}');
  })
  .listen(Number(port), host);
