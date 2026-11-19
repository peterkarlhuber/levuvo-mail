// AI routes: settings, status, models and the AI functions. Message content is loaded here on the
// server (the UI sends references), so the model gets the same text the reader shows and nothing else.
import { internalApi } from './internal-api.mjs';
import { DEFAULT_AI_SETTINGS } from './ai-service.mjs';
import { contactPayload, eventPayload, messageForAi, securityDetails, securityFacts } from './ai-payloads.mjs';
// Re-exported for existing callers; the mappers live in ai-payloads.mjs.
export { messageForAi, securityDetails, securityFacts } from './ai-payloads.mjs';
import { createSemanticIndex } from './ai-semantic.mjs';

const ACTION = 'ai-v1';
const MAX_REFS = 8;
const MAX_CLIENT_TEXT = 60_000;
const STYLE_TTL = 60 * 60 * 1000;
const LOAD_PARALLEL = 3;

/** Runs `fn` over `items` with at most `limit` at once; results keep the order of `items`. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function clientText(value, limit = MAX_CLIENT_TEXT) {
  return String(value ?? '').slice(0, limit);
}

const invalidApply = message => Object.assign(new Error(message), { statusCode: 400 });

export function registerAiRoutes(ctx) {
  const { api, ai, requireAction } = ctx;
  const styleCache = new Map();

  function aiError(reply, err) {
    if (err.statusCode >= 400 && err.statusCode < 500 && !err.kind)
      return reply.code(err.statusCode).send({ error: err.message, code: err.code || 'ai_invalid' });
    const status = err.statusCode || (err.kind === 'timeout' ? 504 : 502);
    return reply.code(status).send({ error: 'KI-Funktion fehlgeschlagen.', code: `ai_${err.kind || 'internal'}` });
  }
  const accountOf = id => {
    const account = ctx.accounts().find(a => a.id === id);
    if (!account) throw Object.assign(new Error('Konto unbekannt.'), { statusCode: 400, code: 'ai_invalid' });
    return account;
  };
  async function loadDetail(accountId, ref) {
    const folder = String(ref?.folder || 'INBOX');
    const uid = Number(ref?.uid);
    if (!Number.isSafeInteger(uid) || uid < 1 || folder.length > 500)
      throw Object.assign(new Error('Ungültige Nachrichten-ID.'), { statusCode: 400, code: 'ai_invalid' });
    return internalApi(ctx).message(accountId, folder, uid);
  }
  async function loadThread(accountId, refs) {
    // Mail content always belongs to one named account: the cloud check depends on it.
    if (!accountId) throw Object.assign(new Error('Konto fehlt.'), { statusCode: 400, code: 'ai_invalid' });
    const list = (Array.isArray(refs) ? refs : []).slice(-MAX_REFS);
    if (!list.length)
      throw Object.assign(new Error('Keine Nachricht gewählt.'), { statusCode: 400, code: 'ai_invalid' });
    // A few at a time instead of one after another (PERF-LEV-007): every load is its own IMAP
    // session, and mail servers allow only a handful of parallel logins per account.
    return mapLimit(list, LOAD_PARALLEL, ref => loadDetail(accountId, ref));
  }
  async function styleSamples(account) {
    const hit = styleCache.get(account.id);
    if (hit && Date.now() - hit.at < STYLE_TTL) return hit.samples;
    const samples = [];
    try {
      const folder = account.sentFolder || 'Sent';
      const listed = await internalApi(ctx).messages(account.id, { folder, limit: 8 });
      const loaded = await mapLimit((listed.messages || []).slice(0, 5), LOAD_PARALLEL, m =>
        loadDetail(account.id, { folder, uid: m.uid }).catch(() => null)
      );
      for (const d of loaded) {
        if (!d) continue;
        // Only the part the user wrote, not the quoted history.
        const own = messageForAi(d)
          .text.split(/\n(?:>|On .+wrote:|Am .+schrieb)/)[0]
          .trim();
        if (own) samples.push(own.slice(0, 1500));
      }
    } catch {
      /* no sent folder: neutral style */
    }
    styleCache.set(account.id, { at: Date.now(), samples });
    return samples;
  }
  const own = () => ctx.ownAddresses().join(', ');
  const profile = () => ({ ...DEFAULT_AI_SETTINGS.profile, ...(ai.publicSettings().profile || {}) });

  /** Builds the sidecar input for one AI function from references and client text. */
  async function prepare(kind, body) {
    const lang = body.lang === 'en' ? 'en' : 'de';
    const accountId = body.account ? String(body.account) : null;
    const account = accountId ? accountOf(accountId) : null;
    const input = body.input && typeof body.input === 'object' ? body.input : {};
    switch (kind) {
      case 'digest':
      case 'extract': {
        const details = await loadThread(accountId, body.refs);
        return {
          lang,
          me: own(),
          messages: details.map(messageForAi),
          now: clientText(input.now, 40),
          timeZone: clientText(input.timeZone, 60)
        };
      }
      case 'translate': {
        const [d] = await loadThread(accountId, body.refs);
        return { lang, target: input.target === 'en' ? 'en' : 'de', text: messageForAi(d).text };
      }
      case 'reply': {
        const details = await loadThread(accountId, body.refs);
        return {
          lang,
          messages: details.map(messageForAi),
          instruction: clientText(input.instruction, 1000),
          profile: profile(),
          styleSamples: account ? await styleSamples(account) : []
        };
      }
      case 'assess': {
        const [d] = await loadThread(accountId, body.refs);
        const message = messageForAi(d);
        const details = securityDetails(d);
        if (details) message.text = `[Check details from the email]\n${details}\n\n${message.text}`;
        return { lang, message, facts: securityFacts(d) };
      }
      case 'rewrite':
        return { lang, mode: clientText(input.mode, 20), text: clientText(input.text), profile: profile() };
      case 'compose': {
        const out = {
          lang,
          bullets: clientText(input.bullets, 3000),
          profile: profile(),
          styleSamples: account ? await styleSamples(account) : []
        };
        if (Array.isArray(body.refs) && body.refs.length)
          out.messages = (await loadThread(accountId, body.refs)).map(messageForAi);
        return out;
      }
      case 'ask': {
        const question = clientText(input.question, 500).trim();
        if (!question) throw Object.assign(new Error('Bitte eine Frage eingeben.'), { statusCode: 400 });
        // Accounts marked "No cloud AI" are left out before the search when a cloud model answers,
        // so none of their text is ever part of the input.
        const ids = (accountId ? [accountId] : ctx.accounts().map(a => a.id)).filter(id => !ai.cloudBlocked(id));
        const hits = await semantic.search(ids, question, { limit: 8 });
        body.sourceMap = hits.map(h => ({ accountId: h.accountId, folder: h.folder, uid: h.uid, subject: h.subject }));
        return {
          lang,
          question,
          sources: hits.map((h, i) => ({
            id: `s${i + 1}`,
            from: `${h.fromName || ''} <${h.fromEmail || ''}>`,
            date: h.date,
            subject: h.subject,
            text: String(h.text || '').slice(0, 2500)
          }))
        };
      }
      case 'filter_rule':
        return {
          lang,
          text: clientText(input.text, 1000),
          folders: (Array.isArray(input.folders) ? input.folders : []).slice(0, 200).map(f => clientText(f, 200))
        };
      case 'attachment_check':
        return { lang, subject: clientText(input.subject, 300), text: clientText(input.text, 6000) };
      case 'presend':
        return {
          lang,
          subject: clientText(input.subject, 300),
          text: clientText(input.text, 6000),
          hasAttachments: input.hasAttachments === true,
          recipients: (Array.isArray(input.recipients) ? input.recipients : [])
            .slice(0, 30)
            .map(r => clientText(r, 200))
        };
      case 'prioritize':
      case 'classify':
        return {
          lang,
          me: own(),
          messages: (Array.isArray(input.messages) ? input.messages : []).slice(0, 60).map(m => ({
            id: clientText(m?.id, 80),
            from: clientText(m?.from, 200),
            subject: clientText(m?.subject, 200),
            preview: clientText(m?.preview, 300)
          }))
        };
      default:
        throw Object.assign(new Error('Unbekannte KI-Funktion.'), { statusCode: 400, code: 'ai_invalid' });
    }
  }

  api.get('/api/ai/settings', async () => ai.publicSettings());
  api.post('/api/ai/settings', { bodyLimit: 8 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    try {
      const before = ai.get().embedModel;
      const saved = await ai.save(request.body || {});
      // Another search model: its vectors are built in the background (the old ones are dropped).
      if (saved.embedModel !== before) setTimeout(() => void syncAll(), 0).unref?.();
      return saved;
    } catch (err) {
      return aiError(reply, err);
    }
  });
  const semantic =
    ctx.semantic ||
    createSemanticIndex({
      localIndex: ctx.localIndex,
      ai,
      logger: ctx.logger,
      stateFile: ctx.semanticState
    });
  ctx.semantic = semantic;
  ctx.aiForgetHooks.push(() => semantic.forget());
  // Keep the vectors close to the index: every 10 minutes, only while AI search is switched on.
  const syncAll = async () => {
    for (const a of ctx.accounts()) await semantic.sync(a.id).catch(() => null);
  };
  ctx.jobs?.register('semantic-index', syncAll, { every: 10 * 60_000, firstDelay: 60_000 });
  // A newly downloaded search model starts its index right away instead of at the next run.
  ai.models?.onReady(id => {
    if (id === ai.get().embedModel) void syncAll();
  });
  // Search by meaning: only metadata goes back to the UI, the reader loads the message itself.
  api.get('/api/ai/search', async (request, reply) => {
    const { q: query, account, folder } = request.query || {};
    try {
      ai.ensureAllowed('search', null);
      const ids = account ? [String(account)].filter(id => accountOf(id)) : ctx.accounts().map(a => a.id);
      const hits = await semantic.search(ids, String(query || ''), {
        limit: 30,
        folder: folder ? String(folder) : null
      });
      return {
        messages: hits.map(h => ({
          accountId: h.accountId,
          folder: h.folder,
          uid: h.uid,
          subject: h.subject,
          fromName: h.fromName,
          fromEmail: h.fromEmail,
          date: h.date,
          score: Math.round(h.score * 1000) / 1000
        })),
        model: ai.get().embedModel,
        generated: true
      };
    } catch (err) {
      return aiError(reply, err);
    }
  });
  api.get('/api/ai/status', async () => ({ settings: ai.publicSettings(), runtime: await ai.status() }));
  api.get('/api/ai/models', async (_request, reply) => {
    try {
      return await ai.models();
    } catch (err) {
      return aiError(reply, err);
    }
  });
  // Levuvo's own Ollama: the fixed model list, downloads with progress, cancel and delete.
  const localModels = ai.models;
  const noRuntime = reply =>
    reply.code(409).send({ error: 'Levuvos eigenes Ollama ist in dieser Installation nicht enthalten.', code: 'ai_runtime_missing' });
  api.get('/api/ai/local-models', async (_request, reply) => {
    if (!localModels) return noRuntime(reply);
    try {
      const list = await localModels.list();
      const s = ai.get();
      const index = s.enabled ? await semantic.progress(ctx.accounts().map(a => a.id)).catch(() => []) : [];
      return { ...list, selected: { model: s.model, embedModel: s.embedModel, provider: s.provider }, index };
    } catch (err) {
      return aiError(reply, err);
    }
  });
  for (const action of ['download', 'cancel', 'delete']) {
    api.post(`/api/ai/local-models/${action}`, { bodyLimit: 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, ACTION)) return;
      if (!localModels) return noRuntime(reply);
      const model = String(request.body?.model || '');
      try {
        if (action === 'download') return { job: await localModels.download(model) };
        if (action === 'cancel') return { job: localModels.cancel(model) };
        return await localModels.remove(model);
      } catch (err) {
        return aiError(reply, err);
      }
    });
  }
  api.post('/api/ai/local-models/discard-partial', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    if (!localModels) return noRuntime(reply);
    try {
      return await localModels.discardPartial();
    } catch (err) {
      return aiError(reply, err);
    }
  });
  api.post('/api/ai/pull', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    try {
      return await ai.pull(request.body?.model);
    } catch (err) {
      return aiError(reply, err);
    }
  });
  api.post('/api/ai/run', { bodyLimit: 256 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const body = request.body || {};
    const kind = String(body.kind || '');
    try {
      const accountId = body.account ? String(body.account) : null;
      ai.ensureAllowed(null, accountId);
      delete body.sourceMap; // set by prepare() only, never taken from the client
      const input = await prepare(kind, body);
      // Every account whose mail text is in the input is checked again, right before the model call.
      const sources = Array.isArray(body.sourceMap) ? body.sourceMap.map(s => s.accountId) : [];
      const result = await ai.run(kind, input, { accountId, sources });
      if (kind === 'ask' && Array.isArray(body.sourceMap))
        result.sources = (result.sources || [])
          .map(id => body.sourceMap[Number(String(id).slice(1)) - 1])
          .filter(Boolean);
      return { kind, result, provider: ai.get().provider, model: ai.get().model, generated: true };
    } catch (err) {
      return aiError(reply, err);
    }
  });
  // "Übernehmen" on an AI suggestion: the user clicked it, so it is saved directly. Events never get
  // attendees here (no invitations); contacts go to the local address book; tasks to the task list.
  api.post('/api/ai/apply', { bodyLimit: 32 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const { type, data } = request.body || {};
    const d = data && typeof data === 'object' ? data : {};
    try {
      if (type === 'event') {
        const payload = eventPayload({ ...d, attendees: [] });
        if (!payload.event.summary || !payload.event.start) throw invalidApply('Titel und Beginn fehlen.');
        if (!payload.event.end) payload.event.end = payload.event.start;
        await internalApi(ctx).saveEvent(payload);
      } else if (type === 'contact') {
        const payload = contactPayload(d);
        if (!payload.contact.name && !payload.contact.emails.length) throw invalidApply('Name oder Adresse fehlt.');
        await internalApi(ctx).saveContact(payload);
      } else if (type === 'task') {
        if (!ctx.tasks?.save)
          throw Object.assign(new Error('Aufgaben sind noch nicht verfügbar.'), { statusCode: 409 });
        const title = clientText(d.title, 300).trim();
        if (!title) throw invalidApply('Titel fehlt.');
        // Link back to the mail the suggestion came from (only for a known account).
        const m = request.body?.mail;
        const uid = Number(m?.uid);
        let mail = null;
        if (m && ctx.accounts().some(a => a.id === m.accountId) && Number.isInteger(uid) && uid > 0) {
          const folder = clientText(m.folder, 1000);
          const meta = await ctx.localIndex?.text?.(m.accountId, folder, uid).catch(() => null);
          mail = {
            accountId: m.accountId,
            folder,
            uid,
            subject: clientText(meta?.subject, 1000),
            from: clientText(meta?.fromEmail, 400)
          };
        }
        await ctx.tasks.save({
          title,
          due: clientText(d.due, 40) || null,
          notes: clientText(d.notes, 2000),
          mail,
          source: 'ai'
        });
      } else throw invalidApply('Unbekannter Vorschlag.');
      void ai.log.add({ type: 'apply', kind: type, source: clientText(request.body?.source, 40) || 'reader' });
      return { saved: true };
    } catch (err) {
      // 4xx from the target (for example 423 when the task store is locked) is passed on as it is.
      const status = err.statusCode || err.status || 500;
      return reply.code(status).send({ error: status < 500 ? err.message : 'Speichern fehlgeschlagen.' });
    }
  });
  api.get('/api/ai/log', async () => ({ entries: await ai.log.list(300) }));
  api.post('/api/ai/log/clear', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    await ai.log.clear();
    return { cleared: true };
  });
  api.post('/api/ai/forget', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    if (request.body?.confirm !== 'FORGET_AI') return reply.code(400).send({ error: 'Bitte bestätigen.' });
    styleCache.clear();
    await ai.forget();
    for (const hook of ctx.aiForgetHooks || []) await hook();
    return { forgotten: true };
  });
}
