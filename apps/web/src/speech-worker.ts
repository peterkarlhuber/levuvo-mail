/// <reference lib="webworker" />
/// <reference types="vite/client" />
// Speech recognition for dictation, in a worker so the window stays responsive. Whisper runs here,
// on this device (WebGPU when available, else WebAssembly). Model files come only from Levuvo's own
// server (downloaded from the fixed list and checked against pinned SHA-256 sums); remote models,
// the browser cache and the CDN fallback for the runtime are switched off.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

type Request =
  | { type: 'load'; model: string; dtype: Record<string, string>; webgpu: boolean }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string };

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/api/ai/speech/files/';
env.useBrowserCache = false;
env.useWasmCache = false;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
  env.backends.onnx.wasm.proxy = false;
}

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loaded = '';

const post = (msg: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

async function load(model: string, dtype: Record<string, string>, webgpu: boolean) {
  if (asr && loaded === model) return;
  await asr?.dispose();
  asr = null;
  const make = (device: 'webgpu' | 'wasm') =>
    pipeline('automatic-speech-recognition', model, {
      device,
      dtype: dtype as never,
      progress_callback: (p: { status?: string; progress?: number; file?: string }) =>
        post({ type: 'progress', status: p.status, progress: p.progress ?? null })
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
  try {
    asr = await make(webgpu ? 'webgpu' : 'wasm');
  } catch (err) {
    if (!webgpu) throw err;
    asr = await make('wasm'); // a GPU that cannot run the model: the CPU still can
  }
  loaded = model;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const msg = event.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model, msg.dtype, msg.webgpu);
      post({ type: 'ready' });
    } else if (msg.type === 'transcribe') {
      if (!asr) throw new Error('not_loaded');
      const out = await asr(msg.audio, {
        language: msg.language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false
      });
      const text = (Array.isArray(out) ? out.map(o => o.text).join(' ') : out.text).trim();
      post({ type: 'result', id: msg.id, text });
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in msg ? msg.id : null, error: String((err as Error)?.message || err) });
  }
};
