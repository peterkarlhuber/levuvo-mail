// Temporary research: the manifest list (per runner variants) for every catalog tag.
import { createHash } from 'node:crypto';
import { MODEL_CATALOG } from '../../apps/server/src/ai-model-catalog.mjs';
const LIST = 'application/vnd.ollama.manifest.list.v2+json';
const V2 = 'application/vnd.docker.distribution.manifest.v2+json';
for (const e of MODEL_CATALOG) {
  const [name, tag = 'latest'] = e.id.split(':');
  for (const ua of [undefined, 'ollama/0.40.16 (arm64 darwin) Go/go1.24.0']) {
    const h = { Accept: `${LIST}, ${V2}` };
    if (ua) h['User-Agent'] = ua;
    const res = await fetch(`https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`, { headers: h });
    const raw = Buffer.from(await res.arrayBuffer());
    let j = {};
    try {
      j = JSON.parse(raw);
    } catch {}
    console.log(
      `${e.id} ua=${ua ? 'ollama' : 'node'} ${res.status} ct=${res.headers.get('content-type')} sha=${createHash('sha256').update(raw).digest('hex')} mt=${j.mediaType} www=${res.headers.get('www-authenticate')}`
    );
    for (const m of j.manifests || []) console.log(`   child ${JSON.stringify(m).slice(0, 400)}`);
  }
}
