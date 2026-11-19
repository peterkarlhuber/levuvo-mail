#!/usr/bin/env node
// Fails when the Electron version of the app has left Electron's support window. Electron
// supports the latest three stable major versions; older lines get no Chromium security fixes.
// Dependabot proposes no major updates (see .github/dependabot.yml), so this check is the signal.
//   node scripts/check-electron-support.mjs
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const SUPPORTED_MAJORS = 3;
const major = version => Number(/^\D*(\d+)\./.exec(String(version))?.[1]);

/** @returns {{ status: 'supported'|'last'|'unsupported', current: number, latest: number }} */
export function electronSupport(current, latest) {
  const cur = major(current);
  const top = major(latest);
  if (!Number.isInteger(cur) || !Number.isInteger(top)) throw new Error(`cannot compare ${current} with ${latest}`);
  const oldest = top - SUPPORTED_MAJORS + 1;
  const status = cur < oldest ? 'unsupported' : cur === oldest && cur !== top ? 'last' : 'supported';
  return { status, current: cur, latest: top, oldest };
}

async function main() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const current = pkg.devDependencies.electron;
  const res = await fetch('https://registry.npmjs.org/-/package/electron/dist-tags', {
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) throw new Error(`npm registry answered ${res.status}`);
  const { latest } = await res.json();
  const s = electronSupport(current, latest);
  const line = `Electron ${current}, latest stable ${latest}, supported majors ${s.oldest}–${s.latest}`;
  if (s.status === 'unsupported') {
    console.error(`✗ ${line}: Electron ${s.current} gets no security fixes any more. Update Electron.`);
    process.exit(1);
  }
  if (s.status === 'last')
    console.log(`::warning::${line}: ${s.current} is the oldest supported line, plan the update.`);
  else console.log(`✓ ${line}`);
}

if (/check-electron-support\.mjs$/.test(process.argv[1] || '')) {
  main().catch(err => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
