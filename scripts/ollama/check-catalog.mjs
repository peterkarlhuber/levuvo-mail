#!/usr/bin/env node
// Checks the pinned model catalog (apps/server/src/ai-model-catalog.mjs) against registry.ollama.ai:
// every tag must still resolve to the pinned manifest digest and size. A re-uploaded model under the
// same name fails here first (and fails closed in the app, which refuses an unexpected digest).
//   node scripts/ollama/check-catalog.mjs        exit 1 on any difference
import { MODEL_CATALOG } from '../../apps/server/src/ai-model-catalog.mjs';
import { fetchManifest } from './registry.mjs';

export async function checkCatalog({ catalog = MODEL_CATALOG, fetchImpl = fetch } = {}) {
  const problems = [];
  for (const entry of catalog) {
    const m = await fetchManifest(entry.id, { fetchImpl });
    if (!m) problems.push(`${entry.id}: no longer on the registry`);
    else {
      if (m.digest !== entry.digest) problems.push(`${entry.id}: digest ${m.digest}, pinned ${entry.digest}`);
      if (m.size !== entry.size) problems.push(`${entry.id}: size ${m.size}, pinned ${entry.size}`);
    }
  }
  return problems;
}

if (/check-catalog\.mjs$/.test(process.argv[1] || '')) {
  const problems = await checkCatalog();
  for (const p of problems) console.log(`✗ ${p}`);
  if (problems.length) process.exit(1);
  console.log(`✓ ${MODEL_CATALOG.length} catalog models match the registry`);
}
