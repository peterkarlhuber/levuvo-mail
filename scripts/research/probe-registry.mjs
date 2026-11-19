// Temporary research: what does registry.ollama.ai serve for the catalog tags under different headers?
import { createHash } from 'node:crypto';
import { MODEL_CATALOG } from '../../apps/server/src/ai-model-catalog.mjs';
const variants = {
  dockerV2: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
  none: {},
  ociAll: {
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
  },
  macUA: {
    Accept: 'application/vnd.docker.distribution.manifest.v2+json',
    'User-Agent': 'ollama/0.40.16 (arm64 darwin) Go/go1.24.0'
  },
  winUA: {
    Accept: 'application/vnd.docker.distribution.manifest.v2+json',
    'User-Agent': 'ollama/0.40.16 (amd64 windows) Go/go1.24.0'
  }
};
const only = process.argv[2];
for (const e of MODEL_CATALOG) {
  if (only && e.id !== only) continue;
  const [name, tag] = e.id.split(':');
  console.log(`\n== ${e.id} pinned ${e.digest} size ${e.size}`);
  for (const [k, h] of Object.entries(variants)) {
    const res = await fetch(`https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`, { headers: h });
    const raw = Buffer.from(await res.arrayBuffer());
    let j = {};
    try {
      j = JSON.parse(raw);
    } catch {}
    const size = (j.layers || []).reduce((n, l) => n + l.size, 0) + (j.config?.size || 0);
    console.log(
      `${k}: ${res.status} ct=${res.headers.get('content-type')} dcd=${res.headers.get('docker-content-digest')} sha=sha256:${createHash('sha256').update(raw).digest('hex')} size=${size} mt=${j.mediaType} manifests=${JSON.stringify(j.manifests?.map(m => ({ d: m.digest, p: m.platform, s: m.size, a: m.annotations })))}`
    );
    if (k === 'dockerV2' || k === 'ociAll')
      for (const l of j.layers || []) console.log(`   ${l.mediaType} ${l.size} ${l.digest}`);
  }
}
