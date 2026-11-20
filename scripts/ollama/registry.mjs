// Read-only client for the Ollama model registry (registry.ollama.ai), used by the catalog checks.
// A model is an OCI-style manifest whose layers are content-addressed blobs (sha256). The manifest's
// own sha256 is what `ollama list` and /api/tags report as the model's digest, so pinning it pins
// every byte of the model.
//
// Since Ollama 0.40 a tag can also be a manifest list with one variant per runner: "llamacpp"
// (GGUF, every platform) and "mlx" (safetensors, Apple silicon). Ollama on a Mac with Apple silicon
// prefers the MLX variant, everywhere else the GGUF one. Each variant is a manifest stored as a blob
// under its own digest; /api/tags then reports the digest of the variant that was downloaded.
import { createHash } from 'node:crypto';

export const REGISTRY = 'https://registry.ollama.ai';
export const MEDIA_MANIFEST = 'application/vnd.docker.distribution.manifest.v2+json';
export const MEDIA_LIST = 'application/vnd.ollama.manifest.list.v2+json';

/** "qwen3:8b" -> { namespace: 'library', name: 'qwen3', tag: '8b' } */
export function parseTag(tag) {
  const m = /^(?:([a-z0-9._-]+)\/)?([a-z0-9._-]+)(?::([A-Za-z0-9._-]+))?$/.exec(String(tag).trim());
  if (!m) throw new Error(`invalid model tag ${tag}`);
  return { namespace: m[1] || 'library', name: m[2], tag: m[3] || 'latest' };
}

const sha256 = raw => `sha256:${createHash('sha256').update(raw).digest('hex')}`;

/** Digest and size (all layers plus config) of one manifest. */
function describe(raw) {
  const manifest = JSON.parse(raw.toString('utf8'));
  const layers = manifest.layers || [];
  return {
    digest: sha256(raw),
    size: layers.reduce((n, l) => n + (l.size || 0), 0) + (manifest.config?.size || 0),
    layers,
    config: manifest.config
  };
}

async function fetchBlob(tag, digest, fetchImpl) {
  const { namespace, name } = parseTag(tag);
  const res = await fetchImpl(`${REGISTRY}/v2/${namespace}/${name}/blobs/${digest}`);
  if (!res.ok) throw new Error(`${tag}: blob ${digest} answered ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  if (sha256(raw) !== digest) throw new Error(`${tag}: blob ${digest} does not match its digest`);
  return raw;
}

/**
 * The manifest of a tag as Ollama 0.40 sees it. For a plain manifest: { digest, size, layers,
 * config, variants: { llamacpp: <same> } }. For a manifest list: { list: digest, variants: { <runner>:
 * { digest, size, layers, config } } }, each variant read from its blob and checked against its digest.
 * `digest`/`size`/`layers` at the top level are those of the GGUF (llamacpp) variant.
 */
export async function fetchManifest(tag, { fetchImpl = fetch } = {}) {
  const { namespace, name, tag: t } = parseTag(tag);
  const res = await fetchImpl(`${REGISTRY}/v2/${namespace}/${name}/manifests/${t}`, {
    headers: { Accept: `${MEDIA_LIST}, ${MEDIA_MANIFEST}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${tag}: registry answered ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const parsed = JSON.parse(raw.toString('utf8'));
  if (parsed.mediaType !== MEDIA_LIST) {
    const plain = describe(raw);
    return { tag, ...plain, variants: { llamacpp: plain } };
  }
  const variants = {};
  for (const child of parsed.manifests || []) {
    const runner = String(child.runner || '').toLowerCase();
    if (!runner || variants[runner]) throw new Error(`${tag}: manifest list with an unexpected variant ${runner}`);
    variants[runner] = { ...describe(await fetchBlob(tag, child.digest, fetchImpl)), format: child.format };
    if (variants[runner].digest !== child.digest) throw new Error(`${tag}: variant ${runner} digest differs`);
  }
  return { tag, list: sha256(raw), ...(variants.llamacpp || {}), variants };
}

export async function fetchBlobText(tag, digest, { fetchImpl = fetch, limit = 4000 } = {}) {
  const { namespace, name } = parseTag(tag);
  const res = await fetchImpl(`${REGISTRY}/v2/${namespace}/${name}/blobs/${digest}`);
  if (!res.ok) throw new Error(`${tag}: blob ${digest} answered ${res.status}`);
  return (await res.text()).slice(0, limit);
}

export const layerOf = (manifest, kind) =>
  manifest.layers.find(l => l.mediaType === `application/vnd.ollama.image.${kind}`);
