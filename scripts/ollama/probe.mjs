// Temporary research probe: which candidate tags exist on the registry, their size, quantization and license.
import { fetchManifest, fetchBlobText, layerOf } from './registry.mjs';

const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : `qwen3:4b qwen3:8b qwen3:14b qwen3.5:2b qwen3.5:4b qwen3.5:9b qwen3.5:14b qwen3.5:27b qwen3.5:35b qwen3.6:4b qwen3.6:9b qwen3.6:14b qwen3.6:27b qwen3.6:35b qwen3.8:4b qwen3.8:9b qwen3.8:14b qwen3.8:27b qwen4:4b qwen4:8b
gemma3:4b gemma3:12b gemma3:27b gemma4:e2b gemma4:e4b gemma4:12b gemma4:26b gemma4:27b gemma4:31b
ministral-3:3b ministral-3:8b ministral-3:14b ministral:3b ministral:8b mistral-small3.2:24b mistral-small3.1:24b mistral-small:24b mistral-small4:24b magistral:24b
eurollm:9b eurollm:22b jobautomation/OpenEuroLLM-German:latest teuken:7b
qwen3-embedding:0.6b qwen3-embedding:4b qwen3-embedding:8b bge-m3:latest bge-m3:567m embeddinggemma:300m granite-embedding:278m snowflake-arctic-embed2:568m`.split(/\s+/);

const gb = n => (n / 1e9).toFixed(2);
for (const tag of CANDIDATES) {
  try {
    const m = await fetchManifest(tag);
    if (!m) {
      console.log(`MISSING  ${tag}`);
      continue;
    }
    let cfg = {};
    try {
      cfg = JSON.parse(await fetchBlobText(tag, m.config.digest));
    } catch {
      /* no config */
    }
    const lic = layerOf(m, 'license');
    let license = '-';
    if (lic) license = (await fetchBlobText(tag, lic.digest, { limit: 300 })).replace(/\s+/g, ' ').trim().slice(0, 140);
    const kinds = m.layers.map(l => l.mediaType.split('.').pop()).join(',');
    console.log(
      `FOUND    ${tag} size=${gb(m.size)}GB digest=${m.digest} family=${cfg.model_family || ''} type=${cfg.model_type || ''} quant=${cfg.file_type || ''} layers=${kinds}`
    );
    console.log(`         license: ${license}`);
  } catch (err) {
    console.log(`ERROR    ${tag} ${err.message}`);
  }
}
