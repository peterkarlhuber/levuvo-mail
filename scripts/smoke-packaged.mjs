#!/usr/bin/env node
// Startup test of the unpacked (not yet installed) application: the program must start
// and run for at least SECONDS seconds without crashing; it is then terminated.
// This is a startup test, NOT a functional test (no account, no mail data).
//   node scripts/smoke-packaged.mjs <win|mac> <arm64|x64> [seconds]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [platform, arch, secs] = process.argv.slice(2);
const seconds = Number(secs || 20);
const exe =
  platform === 'win'
    ? join(resolve('release'), arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked', 'Levuvo Mail.exe')
    : join(
        resolve('release'),
        arch === 'arm64' ? 'mac-arm64' : 'mac',
        'Levuvo Mail.app',
        'Contents',
        'MacOS',
        'Levuvo Mail'
      );
if (!existsSync(exe)) {
  console.error(`✗ Program not found: ${exe}`);
  process.exit(1);
}
const child = spawn(exe, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});
let log = '';
child.stdout.on('data', d => (log += d));
child.stderr.on('data', d => (log += d));
let exited = null;
child.on('exit', (code, signal) => (exited = { code, signal }));
await new Promise(r => setTimeout(r, seconds * 1000));
if (exited) {
  console.error(
    `✗ Application exited after <${seconds}s (code ${exited.code}, signal ${exited.signal}).\n${log.slice(-3000)}`
  );
  process.exit(1);
}
if (platform === 'win') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
else child.kill('SIGTERM');
await new Promise(r => setTimeout(r, 2000));
console.log(
  `✓ ${platform}/${arch}: application ran ${seconds}s without crashing and was shut down in a controlled way.`
);
if (log.trim()) console.log('--- Output ---\n' + log.slice(-1500));
process.exit(0);
