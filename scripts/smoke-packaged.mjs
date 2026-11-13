#!/usr/bin/env node
// Start-Test der entpackten (noch nicht installierten) Anwendung: Das Programm muss starten
// und mindestens SECONDS Sekunden ohne Absturz laufen; danach wird es beendet.
// Das ist ein Start-Test, KEIN Funktionstest (kein Konto, keine Maildaten).
//   node scripts/smoke-packaged.mjs <win|mac> <arm64|x64> [sekunden]
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
  console.error(`✗ Programm nicht gefunden: ${exe}`);
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
    `✗ Anwendung hat sich nach <${seconds}s beendet (Code ${exited.code}, Signal ${exited.signal}).\n${log.slice(-3000)}`
  );
  process.exit(1);
}
if (platform === 'win') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
else child.kill('SIGTERM');
await new Promise(r => setTimeout(r, 2000));
console.log(`✓ ${platform}/${arch}: Anwendung lief ${seconds}s ohne Absturz und wurde kontrolliert beendet.`);
if (log.trim()) console.log('--- Ausgabe ---\n' + log.slice(-1500));
process.exit(0);
