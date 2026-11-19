// The fixed list of local models Levuvo offers for its own Ollama. Nothing outside this list is
// downloaded into the bundled runtime.
//
// Every entry pins the model's manifest digest on registry.ollama.ai. Ollama checks each layer
// against the manifest's sha256 values while it downloads; Levuvo then compares the manifest digest
// with the one pinned here, so the bytes on disk are exactly the bytes that were reviewed
// (docs/ai/MODELS.md). A changed upload under the same name fails the download instead of being
// used. scripts/ollama/check-catalog.mjs checks the pins against the registry in CI.
//
// Variants: a tag on the registry can offer a GGUF variant (runner "llamacpp", every platform) and
// an MLX variant (runner "mlx", Macs with Apple silicon only), with different files and sizes.
// digest/size pin the GGUF variant; mlx pins the MLX one where the registry offers it, or is false
// where an offered MLX variant was reviewed and not taken (Macs then get GGUF too). Levuvo asks
// Ollama for the variant explicitly (variantFor), so what is downloaded never depends on Ollama's
// own preference, and checks it against that variant's pin.
//
// size: bytes of all layers (download size and disk space). minRamGb: memory the model needs to
// run next to the operating system and Levuvo, from the model size plus context.

/** @typedef {'small'|'standard'|'large'|'search'} Tier */

export const MODEL_TIERS = /** @type {const} */ ({
  small: { minRamGb: 8 },
  standard: { minRamGb: 16 },
  large: { minRamGb: 32 },
  search: { minRamGb: 8 }
});

const QWEN_QUERY = 'Instruct: Given a search query, retrieve relevant emails that answer it\nQuery: ';

/**
 * @type {ReadonlyArray<{id: string, name: string, vendor: string, origin: string, eu: boolean,
 *   kind: 'chat'|'embed', tier: Tier, license: string, licenseUrl: string, size: number,
 *   digest: string, mlx?: {digest: string, size: number} | false, default?: boolean, queryPrefix?: string}>}
 */
export const MODEL_CATALOG = Object.freeze([
  // Small, from 8 GB RAM
  {
    id: 'qwen3.5:4b',
    name: 'Qwen3.5 4B',
    vendor: 'Alibaba Qwen',
    origin: 'CN',
    eu: false,
    kind: 'chat',
    tier: 'small',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 3_324_173_934,
    digest: 'sha256:d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
    mlx: { size: 3_973_305_013, digest: 'sha256:7f3251fa6878a78a606bcb3c074283306e5ad2ea411a7774a9dd98a4bc7f2d13' },
    default: true
  },
  {
    id: 'gemma4:e2b',
    name: 'Gemma 4 E2B',
    vendor: 'Google',
    origin: 'US',
    eu: false,
    kind: 'chat',
    tier: 'small',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 4_587_156_505,
    digest: 'sha256:b37049369adfe3d2b653af0ab301a062ca5cbe96ace6aa0d3f2559ee9b563fc2',
    // The MLX variant (7.5 GB) is too big for the small tier: GGUF on every platform.
    mlx: false
  },
  {
    id: 'ministral-3:3b',
    name: 'Ministral 3 3B',
    vendor: 'Mistral AI',
    origin: 'FR',
    eu: true,
    kind: 'chat',
    tier: 'small',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 2_953_840_808,
    digest: 'sha256:f04aa1c738f64e13c625b82ae92504fc0260fa6723b509ed1ece0fa188179b1d'
  },
  // Standard, from 16 GB RAM
  {
    id: 'qwen3.5:9b',
    name: 'Qwen3.5 9B',
    vendor: 'Alibaba Qwen',
    origin: 'CN',
    eu: false,
    kind: 'chat',
    tier: 'standard',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 6_550_825_550,
    digest: 'sha256:56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90',
    mlx: { size: 7_639_229_431, digest: 'sha256:d63f830f28d515fefea546f213fca7a75e9dd5176ef51a6deabc952d1c99a911' },
    default: true
  },
  {
    id: 'gemma4:12b',
    name: 'Gemma 4 12B',
    vendor: 'Google',
    origin: 'US',
    eu: false,
    kind: 'chat',
    tier: 'standard',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 8_021_618_941,
    digest: 'sha256:6114515d63c17436a7c0417d82820ac65ad643e2806c5a3c89cb62846436ed0b',
    mlx: { size: 7_714_091_504, digest: 'sha256:c7597fc90b86aff6965317f37dd5465402284e26382d9b4bf2dfe3ef1491f4b6' }
  },
  {
    id: 'ministral-3:8b',
    name: 'Ministral 3 8B',
    vendor: 'Mistral AI',
    origin: 'FR',
    eu: true,
    kind: 'chat',
    tier: 'standard',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 6_022_236_616,
    digest: 'sha256:1922accd5827ebe6829e536369195db25eaf664528dc66206d646ea3bb386b71'
  },
  // Large, from 32 GB RAM
  {
    id: 'qwen3.8:27b',
    name: 'Qwen3.8 27B',
    vendor: 'Alibaba Qwen',
    origin: 'CN',
    eu: false,
    kind: 'chat',
    tier: 'large',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 17_741_872_154,
    digest: 'sha256:aaee06c39dcf2437cde036998d960e1fc1494b8191be7cc9657d01e509097813',
    mlx: { size: 18_174_721_847, digest: 'sha256:47951e4a666180bc2aedfc93c169472f2de783696fe196efbf063f5730ecf163' },
    default: true
  },
  {
    id: 'mistral-small3.2:24b',
    name: 'Mistral Small 3.2 24B',
    vendor: 'Mistral AI',
    origin: 'FR',
    eu: true,
    kind: 'chat',
    tier: 'large',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 15_177_384_862,
    digest: 'sha256:5a408ab55df5c1b5cf46533c368813b30bf9e4d8fc39263bf2a3338cfa3b895b'
  },
  {
    id: 'ministral-3:14b',
    name: 'Ministral 3 14B',
    vendor: 'Mistral AI',
    origin: 'FR',
    eu: true,
    kind: 'chat',
    tier: 'large',
    license: 'Apache-2.0',
    licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    size: 9_082_537_546,
    digest: 'sha256:4760c35aeb9d9e9c6174c2492562c0b999e80a222804fd96b1915ab72bbcdcf7'
  },
  // Search (embeddings); always local, also when a cloud model writes the answers
  {
    id: 'qwen3-embedding:0.6b',
    name: 'Qwen3-Embedding 0.6B',
    vendor: 'Alibaba Qwen',
    origin: 'CN',
    eu: false,
    kind: 'embed',
    tier: 'search',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B',
    size: 639_150_858,
    digest: 'sha256:ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d',
    queryPrefix: QWEN_QUERY
  },
  {
    id: 'qwen3-embedding:4b',
    name: 'Qwen3-Embedding 4B',
    vendor: 'Alibaba Qwen',
    origin: 'CN',
    eu: false,
    kind: 'embed',
    tier: 'search',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-Embedding-4B',
    size: 2_496_704_041,
    digest: 'sha256:df5bd2e3c74cd8d069d21dc038f1b359fcdc9458fce1c99bd43c9eb1518ff907',
    queryPrefix: QWEN_QUERY
  },
  {
    id: 'bge-m3',
    name: 'BGE-M3',
    vendor: 'BAAI',
    origin: 'CN',
    eu: false,
    kind: 'embed',
    tier: 'search',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/BAAI/bge-m3',
    size: 1_157_672_605,
    digest: 'sha256:7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab',
    // Best of the three on the German test mailbox (docs/ai/MODELS.md), without an instruction.
    queryPrefix: '',
    default: true
  }
]);

/** The variants Levuvo pins and downloads, as Ollama's runner names. */
export const RUNNERS = Object.freeze(['llamacpp', 'mlx']);

/** True on a Mac with Apple silicon, where Ollama runs MLX models. */
export const isAppleSilicon = (platform = process.platform, arch = process.arch) =>
  platform === 'darwin' && arch === 'arm64';

/**
 * The variant of a catalog model downloaded on this computer: { runner, digest, size }. MLX on Apple
 * silicon where the catalog pins one (faster there, Ollama's own choice), GGUF everywhere else.
 */
export function variantFor(entry, platform = process.platform, arch = process.arch) {
  if (entry.mlx && isAppleSilicon(platform, arch)) return { runner: 'mlx', ...entry.mlx };
  return { runner: 'llamacpp', digest: entry.digest, size: entry.size };
}

/** Ollama reports a model as "name:tag"; "bge-m3" is stored as "bge-m3:latest". */
export const ollamaName = id => (String(id).includes(':') ? String(id) : `${id}:latest`);

export const catalogEntry = id => MODEL_CATALOG.find(m => m.id === id || ollamaName(m.id) === id) || null;

export const defaultModel = (tier = 'standard') =>
  MODEL_CATALOG.find(m => m.tier === tier && m.default)?.id ?? MODEL_CATALOG.find(m => m.default).id;

export const DEFAULT_CHAT_MODEL = defaultModel('standard');
export const DEFAULT_EMBED_MODEL = defaultModel('search');

/**
 * The tier for a computer with `totalBytes` of memory. Thresholds sit a little below the nominal
 * size because the system reports usable memory (a "16 GB" laptop shows about 15.5 GiB).
 */
export function recommendedTier(totalBytes) {
  const gib = totalBytes / 1024 ** 3;
  if (gib >= 30) return 'large';
  if (gib >= 15) return 'standard';
  return 'small';
}

/** How well a model fits this computer: 'good', 'tight' (one tier above) or 'too_big'. */
export function fitFor(entry, totalBytes) {
  const order = ['small', 'standard', 'large'];
  if (entry.kind === 'embed') return 'good';
  const have = order.indexOf(recommendedTier(totalBytes));
  const need = order.indexOf(entry.tier);
  if (need <= have) return 'good';
  return need === have + 1 ? 'tight' : 'too_big';
}

/** The search instruction placed in front of a query for this embedding model. */
export const queryPrefixFor = id => catalogEntry(id)?.queryPrefix ?? QWEN_QUERY;
