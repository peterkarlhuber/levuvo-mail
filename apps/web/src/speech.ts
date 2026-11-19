// Dictation: records from the microphone, turns speech into text with Whisper in a worker on this
// device and hands back the text. Nothing of the audio leaves the device; it is not stored either.
import { getJson, postJson } from './api';

export type SpeechModel = {
  id: string;
  name: string;
  size: number;
  quality: 'fast' | 'balanced' | 'best';
  languages: string;
  license: string;
  device: 'any' | 'webgpu';
  dtype: Record<string, string>;
  installed: boolean;
  job: { state: string; completed: number; total: number; error: string | null } | null;
};
export type SpeechState = { models: SpeechModel[]; selected: string | null; enabled: boolean };

export const MAX_SECONDS = 300;
const RATE = 16_000;

export const speechModels = () => getJson<SpeechState>('/api/ai/speech/models');

/** The model to dictate with: the selected one if it is installed, else none. */
export async function dictationModel(): Promise<SpeechModel | null> {
  try {
    const s = await speechModels();
    if (!s.enabled) return null;
    return s.models.find(m => m.id === s.selected && m.installed) || null;
  } catch {
    return null;
  }
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let readyFor = '';
let seq = 0;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let onProgress: ((p: number | null) => void) | null = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module', name: 'levuvo-speech' });
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'progress') onProgress?.(typeof m.progress === 'number' ? m.progress : null);
    if (m.type === 'result') waiting.get(m.id)?.resolve(m.text);
    if (m.type === 'error' && m.id !== null) waiting.get(m.id)?.reject(new Error(m.error));
    if (m.type === 'result' || (m.type === 'error' && m.id !== null)) waiting.delete(m.id);
  };
  return worker;
}

/** Loads the model in the worker (once per model). */
export function loadModel(model: SpeechModel, progress?: (p: number | null) => void) {
  onProgress = progress || null;
  if (ready && readyFor === model.id) return ready;
  readyFor = model.id;
  const w = getWorker();
  ready = new Promise<void>((resolve, reject) => {
    const listen = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        w.removeEventListener('message', listen);
        resolve();
      } else if (e.data.type === 'error' && e.data.id === null) {
        w.removeEventListener('message', listen);
        ready = null;
        reject(new Error(e.data.error));
      }
    };
    w.addEventListener('message', listen);
    const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    w.postMessage({ type: 'load', model: model.id, dtype: model.dtype, webgpu });
  });
  return ready;
}

export function transcribe(audio: Float32Array, language: string) {
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
  });
}

/** Mono 16 kHz samples from a recorded blob. */
export async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(data);
    const frames = Math.ceil(decoded.duration * RATE);
    const offline = new OfflineAudioContext(1, Math.max(1, frames), RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    return (await offline.startRendering()).getChannelData(0);
  } finally {
    void ctx.close();
  }
}

/** A recording from the microphone; `stop()` returns the audio. Stops by itself after MAX_SECONDS. */
export async function startRecording(onAutoStop: () => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  const started = Date.now();
  const timer = window.setTimeout(onAutoStop, MAX_SECONDS * 1000);
  recorder.start(1000);
  const release = () => {
    window.clearTimeout(timer);
    stream.getTracks().forEach(t => t.stop());
  };
  return {
    started,
    stop: () =>
      new Promise<{ blob: Blob; seconds: number }>(resolve => {
        recorder.onstop = () => {
          release();
          resolve({ blob: new Blob(chunks, { type: recorder.mimeType }), seconds: (Date.now() - started) / 1000 });
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else recorder.onstop?.(new Event('stop'));
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    }
  };
}

export const logDictation = (seconds: number, ok: boolean) =>
  postJson('/api/ai/speech/log', { seconds, ok }, 'ai-v1').catch(() => {});
