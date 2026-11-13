// Windows build only: native architecture required for @napi-rs/keyring .node package.
// Use arm64 Node on Windows ARM64 (UTM) and x64 Node on standard Windows.
import { spawnSync } from 'node:child_process';
const target = process.argv[2] || 'native';
if (process.platform !== 'win32') {
  console.error('Windows-Installer bitte in Windows 11 bauen, nicht in macOS/Linux.');
  process.exit(1);
}
const arch = target === 'native' || target === 'dir' ? process.arch : target;
if (!['arm64', 'x64'].includes(arch)) {
  console.error('Nur ARM64 und x64 unterstützt.');
  process.exit(1);
}
if (arch !== process.arch) {
  console.error(
    `Host Node=${process.arch}, Ziel=${arch}. Wegen des nativen Schlüsselbundmoduls bitte auf einem passenden Windows-System bauen bzw. die passende Node.js-Architektur verwenden.`
  );
  process.exit(1);
}
function run(command, args) {
  const p = spawnSync(command, args, { shell: process.platform === 'win32', stdio: 'inherit', env: process.env });
  if (p.error) {
    console.error(p.error.message);
    process.exit(1);
  }
  if (p.status !== 0) process.exit(p.status || 1);
}
run('node', ['scripts/windows-preflight.mjs']);
run('npm', ['run', 'build']);
// Do not publish, sign or upload anything. Windows may warn about an unsigned EXE.
run(
  'npx',
  target === 'dir'
    ? ['electron-builder', '--win', '--dir', `--${arch}`, '--publish', 'never']
    : ['electron-builder', '--win', 'nsis', `--${arch}`, '--publish', 'never']
);
console.log('Windows-Paket erstellt – siehe release/');
