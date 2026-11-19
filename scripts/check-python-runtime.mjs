#!/usr/bin/env node
// Reports when a newer CPython patch release of the bundled line (PYTHON_VERSION in
// build-ai-runtime.mjs) is available from python-build-standalone. Dependabot does not see the
// interpreter, so this is the signal for its security releases. The download list comes from the
// pinned uv (apps/ai/requirements-build.txt, itself updated by Dependabot).
//   node scripts/check-python-runtime.mjs [--strict]    (--strict: exit 1 instead of a warning)
import { spawnSync } from 'node:child_process';
import { PYTHON_VERSION } from './build-ai-runtime.mjs';

const parts = v => String(v).split('.').map(Number);
export function newerPatches(current, available) {
  const [maj, min, patch] = parts(current);
  return [...new Set(available)]
    .filter(v => /^\d+\.\d+\.\d+$/.test(v))
    .filter(v => {
      const [a, b, c] = parts(v);
      return a === maj && b === min && c > patch;
    })
    .sort((x, y) => parts(x)[2] - parts(y)[2]);
}

function main() {
  const strict = process.argv.includes('--strict');
  const line = PYTHON_VERSION.split('.').slice(0, 2).join('.');
  const res = spawnSync(
    'uv',
    ['python', 'list', line, '--only-downloads', '--all-versions', '--output-format', 'json'],
    {
      encoding: 'utf8'
    }
  );
  if (res.status !== 0) throw new Error(`uv python list failed: ${res.stderr || res.error}`);
  const newer = newerPatches(
    PYTHON_VERSION,
    JSON.parse(res.stdout).map(e => e.version)
  );
  if (!newer.length) {
    console.log(`✓ Bundled CPython ${PYTHON_VERSION} is the newest ${line} release known to uv.`);
    return;
  }
  const msg = `Bundled CPython ${PYTHON_VERSION} is behind ${newer.at(-1)}: update PYTHON_VERSION in scripts/build-ai-runtime.mjs.`;
  if (strict) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`::warning::${msg}`);
}

if (/check-python-runtime\.mjs$/.test(process.argv[1] || '')) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
