// AI routes: settings, status, models and the AI functions. Message content is loaded here on the
// server (the UI sends references), so the model gets the same text the reader shows and nothing else.
import { htmlToText } from './html-mail.mjs';
import { DEFAULT_AI_SETTINGS } from './ai-service.mjs';

const ACTION = 'ai-v1';
const MAX_REFS = 8;
const MAX_CLIENT_TEXT = 60_000;
const STYLE_TTL = 60 * 60 * 1000;

const addr = list =>
  (list || [])
    .map(a => (a.name ? `${a.name} <${a.email}>` : a.email))
    .filter(Boolean)
    .join(', ');

function clientText(value, limit = MAX_CLIENT_TEXT) {
  return String(value ?? '').slice(0, limit);
}

export function messageForAi(detail) {
  const text = detail.text?.trim() ? detail.text : htmlToText(detail.html || '');
  return {
    from: addr(detail.from),
    to: addr([...(detail.to || []), ...(detail.cc || [])]),
    date: detail.date || '',
    subject: detail.subject || '',
    text: String(text || '').slice(0, 20_000),
    attachments: (detail.attachments || []).map(a => a.filename).slice(0, 20)
  };
}

export function securityFacts(detail) {
  const sec = detail.security || {};
  const facts = { client_rating: sec.level || 'unknown' };
  for (const [k, v] of Object.entries(sec.auth || {})) if (v) facts[k] = v;
  for (const c of (sec.checks || []).slice(0, 12)) {
    const extra = ['shown', 'actual', 'replyTo', 'filename', 'domain']
      .map(k => c[k])
      .filter(Boolean)
      .join(' → ');
    facts[`check_${c.code}`] = `${c.level}${extra ? `: ${extra}` : ''}`;
  }
  facts.attachments =
    (detail.attachments || [])
      .map(a => a.filename)
      .slice(0, 10)
      .join(', ') || 'none';
  return facts;
}

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
    return ctx.internalRequest(
      'GET',
      `/api/messages/${uid}?folder=${encodeURIComponent(folder)}&account=${encodeURIComponent(accountId)}`
    );
  }
  async function loadThread(accountId, refs) {
    const list = (Array.isArray(refs) ? refs : []).slice(-MAX_REFS);
    if (!list.length)
      throw Object.assign(new Error('Keine Nachricht gewählt.'), { statusCode: 400, code: 'ai_invalid' });
    const details = [];
    for (const ref of list) details.push(await loadDetail(accountId, ref));
    return details;
  }
  async function styleSamples(account) {
    const hit = styleCache.get(account.id);
    if (hit && Date.now() - hit.at < STYLE_TTL) return hit.samples;
    const samples = [];
    try {
      const folder = account.sentFolder || 'Sent';
      const listed = await ctx.internalRequest(
        'GET',
        `/api/messages?folder=${encodeURIComponent(folder)}&limit=8&account=${encodeURIComponent(account.id)}`
      );
      for (const m of (listed.messages || []).slice(0, 5)) {
        const d = await loadDetail(account.id, { folder, uid: m.uid }).catch(() => null);
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
        return { lang, message: messageForAi(d), facts: securityFacts(d) };
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
      case 'attachment_check':
        return { lang, subject: clientText(input.subject, 300), text: clientText(input.text, 6000) };
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
      return await ai.save(request.body || {});
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
      const input = await prepare(kind, body);
      const result = await ai.run(kind, input, { accountId });
      return { kind, result, provider: ai.get().provider, model: ai.get().model, generated: true };
    } catch (err) {
      return aiError(reply, err);
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
