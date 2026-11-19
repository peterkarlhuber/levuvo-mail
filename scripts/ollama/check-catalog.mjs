#!/usr/bin/env node
// Checks the pinned model catalog (apps/server/src/ai-model-catalog.mjs) against registry.ollama.ai:
// every variant Levuvo downloads must still resolve to the pinned manifest digest and size, the GGUF
// one (Windows, Intel Macs, Linux) and the MLX one (Macs with Apple silicon). A re-uploaded model
// under the same name fails here first (and fails closed in the app, which refuses an unexpected
// digest). A variant the registry offers but the catalog does not pin is reported too, so the pins
// are updated before anyone could be surprised by it.
//   node scripts/ollama/check-catalog.mjs          exit 1 on any difference
//   node scripts/ollama/check-catalog.mjs --print  also print the registry values to paste
import { MODEL_CATALOG, RUNNERS } from '../../apps/server/src/ai-model-catalog.mjs';
import { fetchManifest } from './registry.mjs';

export async function checkCatalog({ catalog = MODEL_CATALOG, fetchImpl = fetch, found = [] } = {}) {
  const problems = [];
  for (const entry of catalog) {
    const m = await fetchManifest(entry.id, { fetchImpl });
    if (!m) {
      problems.push(`${entry.id}: no longer on the registry`);
      continue;
    }
    found.push({ id: entry.id, variants: m.variants });
    const pins = { llamacpp: { digest: entry.digest, size: entry.size }, ...(entry.mlx ? { mlx: entry.mlx } : {}) };
    for (const runner of RUNNERS) {
      const pin = pins[runner];
      const got = m.variants[runner];
      if (pin && !got) problems.push(`${entry.id} (${runner}): variant no longer offered, pinned ${pin.digest}`);
      else if (!pin && got) problems.push(`${entry.id} (${runner}): new variant ${got.digest} (${got.size} bytes), not pinned`);
      else if (pin && got) {
        if (got.digest !== pin.digest) problems.push(`${entry.id} (${runner}): digest ${got.digest}, pinned ${pin.digest}`);
        if (got.size !== pin.size) problems.push(`${entry.id} (${runner}): size ${got.size}, pinned ${pin.size}`);
      }
    }
    for (const runner of Object.keys(m.variants))
      if (!RUNNERS.includes(runner)) problems.push(`${entry.id}: unknown variant ${runner}`);
  }
  return problems;
}

if (/check-catalog\.mjs$/.test(process.argv[1] || '')) {
  const found = [];
  const problems = await checkCatalog({ found });
  if (process.argv.includes('--print') || problems.length)
    for (const f of found)
      for (const [runner, v] of Object.entries(f.variants)) console.log(`  ${f.id} ${runner}: ${v.digest} ${v.size}`);
  for (const p of problems) console.log(`✗ ${p}`);
  if (problems.length) process.exit(1);
  const variants = found.reduce((n, f) => n + Object.keys(f.variants).length, 0);
  console.log(`✓ ${MODEL_CATALOG.length} catalog models (${variants} variants) match the registry`);
}
