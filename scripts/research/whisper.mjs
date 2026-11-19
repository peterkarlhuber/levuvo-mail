// Temporary research: which files transformers.js needs per Whisper model and dtype, their sizes and
// SHA-256, and whether a German sentence is recognised.
import { pipeline, env } from '@huggingface/transformers';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const audio = new Float32Array(readFileSync('/tmp/de.f32').buffer.slice(0));
const MODELS = [
  ['onnx-community/whisper-base', { encoder_model: 'fp32', decoder_model_merged: 'q4' }],
  ['onnx-community/whisper-small', { encoder_model: 'fp32', decoder_model_merged: 'q4' }],
  ['onnx-community/whisper-large-v3-turbo', { encoder_model: 'fp16', decoder_model_merged: 'q4' }]
];
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
for (const [repo, dtype] of MODELS) {
  const cache = `/tmp/hf/${repo.split('/')[1]}`;
  env.cacheDir = cache;
  try {
    const t0 = Date.now();
    const asr = await pipeline('automatic-speech-recognition', repo, { dtype, device: 'cpu' });
    const t1 = Date.now();
    const out = await asr(audio, { language: 'german', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    console.log(`ASR ${repo} load ${t1 - t0} ms, transcribe ${Date.now() - t1} ms: ${out.text}`);
    await asr.dispose();
  } catch (e) {
    console.log(`ASR FAILED ${repo}`, e);
  }
  for (const f of walk(cache)) {
    const buf = readFileSync(f);
    console.log(`  CATFILE ${repo} ${relative(join(cache, repo), f)} ${statSync(f).size} ${createHash('sha256').update(buf).digest('hex')}`);
  }
}
