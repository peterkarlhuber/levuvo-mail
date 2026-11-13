// node --check for every server, desktop and script module.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dirs = ['apps/server/src', 'apps/desktop', 'scripts'];
let failed = 0;
for (const dir of dirs) {
  for (const file of readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) failed++;
  }
}
if (failed) {
  console.error(`${failed} Datei(en) mit Syntaxfehlern.`);
  process.exit(1);
}
console.log('Syntaxprüfung: alle Module in Ordnung.');
