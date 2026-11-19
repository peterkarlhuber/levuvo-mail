// Read-only client for the Ollama model registry (registry.ollama.ai), used by the catalog checks.
// A model is an OCI-style manifest whose layers are content-addressed blobs (sha256). The manifest's
// own sha256 is what `ollama list` and /api/tags report as the model's digest, so pinning it pins
// every byte of the model.
import { createHash } from 'node:crypto';

export const REGISTRY = 'https://registry.ollama.ai';
const ACCEPT = 'application/vnd.docker.distribution.manifest.v2+json';

/** "qwen3:8b" -> { namespace: 'library', name: 'qwen3', tag: '8b' } */
export function parseTag(tag) {
  const m = /^(?:([a-z0-9._-]+)\/)?([a-z0-9._-]+)(?::([A-Za-z0-9._-]+))?$/.exec(String(tag).trim());
  if (!m) throw new Error(`invalid model tag ${tag}`);
  return { namespace: m[1] || 'library', name: m[2], tag: m[3] || 'latest' };
}

export async function fetchManifest(tag, { fetchImpl = fetch } = {}) {
  const { namespace, name, tag: t } = parseTag(tag);
  const res = await fetchImpl(`${REGISTRY}/v2/${namespace}/${name}/manifests/${t}`, { headers: { Accept: ACCEPT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${tag}: registry answered ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const manifest = JSON.parse(raw.toString('utf8'));
  const layers = manifest.layers || [];
  return {
    tag,
    digest: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    size: layers.reduce((n, l) => n + (l.size || 0), 0) + (manifest.config?.size || 0),
    layers,
    config: manifest.config
  };
}

export async function fetchBlobText(tag, digest, { fetchImpl = fetch, limit = 4000 } = {}) {
  const { namespace, name } = parseTag(tag);
  const res = await fetchImpl(`${REGISTRY}/v2/${namespace}/${name}/blobs/${digest}`);
  if (!res.ok) throw new Error(`${tag}: blob ${digest} answered ${res.status}`);
  return (await res.text()).slice(0, limit);
}

export const layerOf = (manifest, kind) =>
  manifest.layers.find(l => l.mediaType === `application/vnd.ollama.image.${kind}`);
