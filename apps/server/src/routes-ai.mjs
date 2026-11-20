// AI routes: settings, status, models and the AI functions. Message content is loaded here on the
// server (the UI sends references), so the model gets the same text the reader shows and nothing else.
import { internalApi } from './internal-api.mjs';
import { DEFAULT_AI_SETTINGS } from './ai-service.mjs';
import { contactPayload, eventPayload, messageForAi, securityDetails, securityFacts } from './ai-payloads.mjs';
// Re-exported for existing callers; the mappers live in ai-payloads.mjs.
export { messageForAi, securityDetails, securityFacts } from './ai-payloads.mjs';
import { createSemanticIndex } from './ai-semantic.mjs';
import { readSources, relevant, retrieve, verifiedQuote } from './ask-mailbox.mjs';
import { mailBudget } from './ai-model-options.mjs';
import { contactSamples, createStyleProfiles } from './style-profile.mjs';

const ACTION = 'ai-v1';
const MAX_REFS = 8;
const MAX_NEWSLETTERS = 20;
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

/**
 * The sources of an answer for the UI: only mails that were really given to the model, each with
 * its metadata and a quote that literally occurs in it (or none). Mail text stays on the server.
 * Manual sections ("m1" …) the model cited come from manualMap and link to the Help.
 */
export function askSources(result, sourceMap, manualMap = []) {
  const quotes = new Map((result.quotes || []).map(q => [String(q?.id), String(q?.quote || '')]));
  const out = [];
  for (const id of result.sources || []) {
    const n = Number(String(id).slice(1)) - 1;
    if (String(id).startsWith('m')) {
      const m = manualMap[n];
      if (m && !out.includes(m)) out.push(m);
      continue;
    }
    const s = sourceMap[n];
    if (!s || out.some(o => o.accountId === s.accountId && o.folder === s.folder && o.uid === s.uid)) continue;
    const quote = verifiedQuote(quotes.get(String(id)), s);
    const attachment = quote ? (s.attachments || []).find(a => verifiedQuote(quote, { text: a.text })) : null;
    out.push({
      accountId: s.accountId,
      folder: s.folder,
      uid: s.uid,
      subject: s.subject,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      date: s.date,
      quote,
      attachment: attachment ? attachment.filename : ''
    });
  }
  return out;
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

  /** Earlier turns of a follow-up question; they help find and understand, they are not trusted. */
  const askHistory = input =>
    (Array.isArray(input.history) ? input.history : []).slice(-2).map(h => ({
      question: clientText(h?.question, 500),
      answer: clientText(h?.answer, 1500)
    }));

  /**
   * Step 2 of a question, after the model called search_mailbox: search with its words, keep only
   * relevant mails and let the model answer from them. With no relevant mail the model is not asked
   * again: "nothing found" is the honest answer, not the nearest unrelated mail.
   */
  async function askWithMail(body, first, query, tool = 'search_mailbox') {
    const lang = first.lang;
    const accountId = body.account ? String(body.account) : null;
    // "How do I …": the best matching sections of the user manual (no personal data). The manual
    // tool searches only there; the mailbox search adds matching sections too.
    const manualHits = ctx.manual
      ? await ctx.manual.search(`${query} ${first.question}`, { lang, limit: 3 }).catch(() => [])
      : [];
    const manualMap = manualHits.map(h => ({
      manual: true,
      chapterId: h.chapterId,
      section: h.number,
      title: h.title
    }));
    const manual = manualHits.map((h, i) => ({
      id: `m${i + 1}`,
      title: [h.number, h.title].filter(Boolean).join(' '),
      chapter: h.chapter,
      text: h.text.slice(0, 2500)
    }));
    // Accounts marked "No cloud AI" are left out before the search when a cloud model answers,
    // so none of their text is ever part of the input.
    const ids = (accountId ? [accountId] : ctx.accounts().map(a => a.id)).filter(id => !ai.cloudBlocked(id));
    const hits =
      tool === 'search_manual'
        ? []
        : await retrieve({
            semantic,
            localIndex: ctx.localIndex,
            ids,
            question: query,
            context: [first.question, ...first.history.map(h => h.question)].join(' '),
            limit: 8
          });
    const useful = hits.filter(h => relevant(h));
    // A fixed text of the app, not written by the model (`fixed`).
    if (!useful.length && !manual.length)
      return {
        result: { answer: notFound(lang), found: false, sources: [], fixed: true },
        sourceMap: [],
        manualMap: []
      };
    if (!useful.length) {
      const result = await ai.run('ask', { ...first, sources: [], manual }, { accountId });
      return { result, sourceMap: [], manualMap };
    }
    const read = await readSources(useful, {
      mapLimit,
      load: async h => messageForAi(await loadDetail(h.accountId, h)),
      attachments: async h => (await internalApi(ctx).attachmentText(h.accountId, h.folder, h.uid)).files
    });
    const sourceMap = read.map(h => ({
      accountId: h.accountId,
      folder: h.folder,
      uid: h.uid,
      subject: h.subject,
      fromName: h.fromName || '',
      fromEmail: h.fromEmail || '',
      date: h.date || '',
      text: h.text,
      attachments: h.attachments
    }));
    // The mails are trimmed to what fits the context of the model next to rules, question and answer.
    let budget = mailBudget(ai.options());
    const sources = read.map((h, i) => {
      const share = Math.max(800, Math.floor(budget / Math.max(1, read.length - i)));
      const text = String(h.text || '').slice(0, Math.min(i < 5 ? 6000 : 2000, share));
      let left = Math.max(0, share - text.length);
      const attachments = [];
      for (const a of h.attachments || []) {
        if (left < 400) break;
        const part = a.text.slice(0, Math.min(4000, left));
        attachments.push({ name: a.filename, text: part });
        left -= part.length;
      }
      budget -= share - left;
      return {
        id: `s${i + 1}`,
        from: `${h.fromName || ''} <${h.fromEmail || ''}>`,
        to: h.to || '',
        date: h.date,
        subject: h.subject,
        text,
        attachments
      };
    });
    const result = await ai.run(
      'ask',
      { ...first, sources, manual },
      { accountId, sources: sourceMap.map(s => s.accountId) }
    );
    return { result, sourceMap, manualMap };
  }

  // Writing style per contact (opt-in): learned locally from sent mail, encrypted on disk.
  let memoryStyle = { accounts: {} };
  const styles =
    ctx.styles ||
    createStyleProfiles({
      file: ctx.styleFile || {
        persistent: false,
        get: () => memoryStyle,
        save: async next => {
          memoryStyle = next;
        }
      },
      localIndex: ctx.localIndex
    });
  ctx.styles = styles;
  const addressesOf = account => (ctx.accountAddresses ? ctx.accountAddresses(account) : ctx.ownAddresses());
  async function learnStyles() {
    if (!profile().learnStyle) return;
    for (const account of ctx.accounts()) {
      const learned = await styles.learn(account, addressesOf(account)).catch(() => null);
      if (learned)
        void ai.log?.add({
          type: 'index',
          kind: 'style',
          accountId: account.id,
          count: learned.mails,
          provider: 'local'
        });
    }
  }
  ctx.jobs?.register('style-profile', learnStyles, { every: 6 * 60 * 60_000, firstDelay: 2 * 60_000 });
  ctx.aiForgetHooks.push(() => styles.clear());

  /** The person a reply or new mail goes to: the sender of the last mail, or its recipient if that was the user. */
  function recipientOf(details, account) {
    const mine = new Set(addressesOf(account).map(a => a.toLowerCase()));
    const last = details.at(-1) || {};
    const from = String(last.from?.[0]?.email || '').toLowerCase();
    if (from && !mine.has(from)) return from;
    return String((last.to || []).map(a => a.email).find(e => e && !mine.has(e.toLowerCase())) || '').toLowerCase();
  }
  /** Style input for reply/compose: habits with this recipient and the user's mails to them first. */
  async function styleInput(account, recipient) {
    if (!account) return { styleSamples: [] };
    const general = await styleSamples(account);
    if (!profile().learnStyle || !recipient) return { styleSamples: general };
    const habits = styles.contact(account.id, recipient);
    const own = await contactSamples(ctx.localIndex, account.id, addressesOf(account), recipient);
    return {
      styleSamples: [...own, ...general].slice(0, 5),
      contactStyle: habits
        ? {
            greeting: habits.greeting,
            closing: habits.closing,
            address: habits.address,
            words: habits.words,
            count: habits.count
          }
        : null,
      styleContact: habits || own.length ? recipient : ''
    };
  }

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
      case 'newsletters': {
        // Weekly overview of the newsletter bundle: up to 20 newsletters of one account, shortened.
        if (!accountId) throw Object.assign(new Error('Konto fehlt.'), { statusCode: 400, code: 'ai_invalid' });
        const refs = (Array.isArray(body.refs) ? body.refs : []).slice(0, MAX_NEWSLETTERS);
        if (!refs.length)
          throw Object.assign(new Error('Keine Nachricht gewählt.'), { statusCode: 400, code: 'ai_invalid' });
        const details = await mapLimit(refs, LOAD_PARALLEL, ref => loadDetail(accountId, ref));
        return {
          lang,
          items: details.map((d, i) => {
            const m = messageForAi(d);
            return { id: `n${i + 1}`, from: m.from, date: m.date, subject: m.subject, text: m.text.slice(0, 2500) };
          })
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
          ...(await styleInput(account, account ? recipientOf(details, account) : ''))
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
          profile: profile()
        };
        const details = Array.isArray(body.refs) && body.refs.length ? await loadThread(accountId, body.refs) : [];
        if (details.length) out.messages = details.map(messageForAi);
        // A new mail: the first recipient the user typed; an answer: as for reply.
        const typed = clientText(Array.isArray(input.to) ? input.to[0] : input.to, 320)
          .trim()
          .toLowerCase();
        Object.assign(
          out,
          await styleInput(account, typed || (account && details.length ? recipientOf(details, account) : ''))
        );
        return out;
      }
      case 'ask': {
        // Step 1 of a question: the model decides itself whether it needs the mailbox (tool
        // search_mailbox). No mail is part of this input. Step 2 is `askWithMail` below.
        const question = clientText(input.question, 500).trim();
        if (!question) throw Object.assign(new Error('Bitte eine Frage eingeben.'), { statusCode: 400 });
        const s = ai.get();
        return {
          lang,
          question,
          history: askHistory(input),
          assistant: { model: s.model, provider: s.provider },
          ...(Number.isInteger(input.minTokens) ? { minTokens: Math.min(16384, Math.max(0, input.minTokens)) } : {})
        };
      }
      case 'filter_rule':
      case 'automation_rule':
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
      const learnedBefore = profile().learnStyle;
      const saved = await ai.save(request.body || {});
      // Another search model: its vectors are built in the background (the old ones are dropped).
      if (saved.embedModel !== before) void syncAll();
      // Style learning switched on: learn now; switched off: the profile is deleted.
      const learnNow = profile().learnStyle;
      if (learnNow && !learnedBefore) void learnStyles();
      if (!learnNow && learnedBefore) await styles.clear();
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
  ai.localModels?.onReady(id => {
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
  // Levuvo Mail's own Ollama: the fixed model list, downloads with progress, cancel and delete.
  const localModels = ai.localModels;
  const noRuntime = reply =>
    reply.code(409).send({
      error: 'Das eigene Ollama von Levuvo Mail ist in dieser Installation nicht enthalten.',
      code: 'ai_runtime_missing'
    });
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
  // Status of the semantic index for Settings and the search: counts and state only, no content.
  const embedInstalled = async () => {
    if (!localModels) return true;
    const list = await localModels.list().catch(() => null);
    return Boolean(list?.models?.find(m => m.id === ai.get().embedModel)?.installed);
  };
  api.get('/api/ai/index-status', async () =>
    semantic.overview(
      ctx.accounts().map(a => a.id),
      { modelInstalled: ai.get().enabled ? await embedInstalled() : true }
    )
  );
  api.post('/api/ai/index/:action', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const ids = ctx.accounts().map(a => a.id);
    switch (request.params.action) {
      case 'pause':
        await semantic.pause();
        break;
      case 'resume':
        await semantic.resume();
        void syncAll();
        break;
      case 'rebuild':
        await semantic.rebuild(ids);
        void syncAll();
        break;
      default:
        return reply.code(404).send({ error: 'Unbekannte Aktion.', code: 'not_found' });
    }
    return semantic.overview(ids, { modelInstalled: await embedInstalled() });
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
      const input = await prepare(kind, body);
      let result = await ai.run(kind, input, { accountId });
      if (kind === 'ask') {
        let sourceMap = [];
        let manualMap = [];
        if (typeof result.search === 'string')
          ({ result, sourceMap, manualMap } = await askWithMail(
            body,
            input,
            clientText(result.search, 300).trim() || input.question,
            result.tool === 'search_manual' ? 'search_manual' : 'search_mailbox'
          ));
        // Without an answer in the mails or the manual there is no source to show.
        result.sources = result.found === false ? [] : askSources(result, sourceMap, manualMap);
        delete result.quotes;
      }
      if ((kind === 'reply' || kind === 'compose') && input.styleContact) result.styleContact = input.styleContact;
      const generated = !result.fixed;
      delete result.fixed;
      return { kind, result, provider: ai.get().provider, model: ai.get().model, generated };
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
  // The learned writing style: what was learned per account and contact, relearn, delete.
  api.get('/api/ai/style', async () => ({
    enabled: profile().learnStyle,
    persistent: styles.persistent,
    accounts: ctx.accounts().map(a => {
      const p = styles.get(a.id);
      return {
        accountId: a.id,
        label: a.label || a.user || a.id,
        builtAt: p?.builtAt || null,
        mails: p?.mails || 0,
        overall: p?.overall || null,
        contacts: Object.entries(p?.contacts || {})
          .map(([email, c]) => ({ email, ...c }))
          .sort((x, y) => y.count - x.count || x.email.localeCompare(y.email))
      };
    })
  }));
  api.post('/api/ai/style/learn', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    if (!profile().learnStyle) return reply.code(409).send({ error: 'Stil lernen ist ausgeschaltet.' });
    await learnStyles();
    return { learned: true };
  });
  api.post('/api/ai/style/remove', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    const { account, contact } = request.body || {};
    if (!ctx.accounts().some(a => a.id === account)) return reply.code(400).send({ error: 'Konto unbekannt.' });
    if (contact) return { removed: await styles.removeContact(account, clientText(contact, 320)) };
    await styles.clear(account);
    return { removed: true };
  });
  api.post('/api/ai/style/clear', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    await styles.clear();
    return { cleared: true };
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

/** The answer when no mail is relevant to a question, in the UI language. */
export function notFound(lang) {
  return lang === 'en'
    ? 'I found nothing about this in your mail. Try other words, a name or a subject.'
    : 'Dazu habe ich in deinen Mails nichts gefunden. Versuch es mit anderen Worten, einem Namen oder einem Betreff.';
}
