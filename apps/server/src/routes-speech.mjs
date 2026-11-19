// Dictation: the speech models (list, download with checksum, delete) and their files for the app's
// own page, which runs Whisper itself. Audio is never sent here; the page only reports how long a
// dictation was, for the AI log (no content).
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createSpeechModels } from './speech-models.mjs';

const ACTION = 'ai-v1';
const TYPES = { '.json': 'application/json; charset=utf-8', '.onnx': 'application/octet-stream', '.txt': 'text/plain' };

export function registerSpeechRoutes(ctx) {
  const { api, ai, requireAction } = ctx;
  const speech =
    ctx.speechModels ||
    createSpeechModels({ dir: path.join(ctx.dataDir, 'speech'), fetchImpl: ctx.fetchImpl || fetch, log: ai.log });
  ctx.speechModels = speech;
  const fail = (reply, err) =>
    reply
      .code(err.statusCode || 500)
      .send({ error: err.statusCode < 500 ? err.message : 'Fehlgeschlagen.', code: err.code || 'ai_internal' });

  api.get('/api/ai/speech/models', async () => ({
    ...(await speech.list()),
    selected: ai.get().speechModel || null,
    enabled: Boolean(ai.get().enabled && ai.get().features?.dictation !== false)
  }));
  for (const action of ['download', 'cancel', 'delete']) {
    api.post(`/api/ai/speech/${action}`, { bodyLimit: 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, ACTION)) return;
      const model = String(request.body?.model || '');
      try {
        if (action === 'download') {
          const job = await speech.download(model);
          // The model being downloaded becomes the dictation model.
          if (ai.get().speechModel !== model) await ai.save({ speechModel: model });
          return { job };
        }
        if (action === 'cancel') return { job: speech.cancel(model) };
        const out = await speech.remove(model);
        if (ai.get().speechModel === model) await ai.save({ speechModel: '' });
        return out;
      } catch (err) {
        return fail(reply, err);
      }
    });
  }
  api.post('/api/ai/speech/discard-partial', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    return speech.discardPartial();
  });
  // The model files, for the app's page only (same origin; the path must be a file of the list).
  api.get('/api/ai/speech/files/:model/*', async (request, reply) => {
    const file = await speech.file(String(request.params.model), String(request.params['*'] || ''));
    if (!file) return reply.code(404).send({ error: 'Nicht gefunden.' });
    reply.headers({
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    });
    return reply.send(createReadStream(file));
  });
  // One entry per dictation in the AI log: length and model only, never audio or text.
  api.post('/api/ai/speech/log', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const seconds = Math.max(0, Math.min(3600, Math.round(Number(request.body?.seconds) || 0)));
    const model = String(ai.get().speechModel || '').slice(0, 80);
    void ai.log?.add({
      type: 'task',
      kind: 'dictate',
      provider: 'local',
      model,
      seconds,
      ok: request.body?.ok !== false
    });
    return { logged: true };
  });
}
