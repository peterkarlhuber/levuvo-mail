// The assistant panel: the model decides itself whether to search (tool search_mailbox), only
// relevant mails reach it, "nothing found" is honest, and the advanced model settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFile } from '../src/app.mjs';
import { createAiService, createAiLog, DEFAULT_AI_SETTINGS } from '../src/ai-service.mjs';
import { registerAiRoutes, notFound } from '../src/routes-ai.mjs';
import { relevant, MIN_COSINE } from '../src/ask-mailbox.mjs';
import {
  effectiveModelOptions,
  mailBudget,
  modelLimits,
  validateModelOptions,
  CONTEXT_MAX
} from '../src/ai-model-options.mjs';
import { ollamaEnv } from '../src/ollama-runtime.mjs';

const GIB = 1024 ** 3;

async function setup(t, answer) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-assistant-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const sidecar = {
    running: true,
    async call(method, params) {
      calls.push({ method, params });
      return method === 'task' ? answer(params.input) : { ok: true };
    },
    async stop() {},
    diagnostics: () => ({})
  };
  const ai = createAiService({
    settingsFile: await createJsonFile(join(dir, 'ai.json'), DEFAULT_AI_SETTINGS),
    vault: { available: false },
    sidecar,
    log: createAiLog(join(dir, 'log.jsonl')),
    totalmem: () => 16 * GIB
  });
  await ai.save({ enabled: true, provider: 'ollama', model: 'ministral-3:3b' });
  const handlers = {};
  const searched = [];
  const ctx = {
    api: {
      get: (p, ...rest) => (handlers[`GET ${p}`] = rest.at(-1)),
      post: (p, ...rest) => (handlers[`POST ${p}`] = rest.at(-1))
    },
    ai,
    requireAction: () => true,
    accounts: () => [{ id: 'a1' }],
    ownAddresses: () => [],
    aiForgetHooks: [],
    semantic: {
      async search(_ids, query) {
        searched.push(query);
        return [
          { accountId: 'a1', folder: 'INBOX', uid: 7, subject: 'Angebot', text: 'Preis 4.250 EUR', score: 0.71 },
          { accountId: 'a1', folder: 'INBOX', uid: 8, subject: 'Storage Share', text: 'Nextcloud', score: 0.3 }
        ];
      },
      sync: async () => null,
      forget: async () => {}
    }
  };
  registerAiRoutes(ctx);
  const reply = { code: () => reply, send: x => x };
  const ask = (question, extra = {}) =>
    handlers['POST /api/ai/run']({ body: { kind: 'ask', lang: 'de', input: { question, ...extra } } }, reply);
  return { ai, calls, ask, searched };
}

const tasks = calls => calls.filter(c => c.method === 'task').map(c => c.params.input);

test('a greeting the model answers itself: no search, no mail in any model input', async t => {
  const { ask, calls, searched } = await setup(t, () => ({
    answer: 'Hallo! Ich bin der Levuvo Mail Assistant.',
    found: true,
    sources: []
  }));
  const out = await ask('hi');
  assert.equal(out.result.answer, 'Hallo! Ich bin der Levuvo Mail Assistant.');
  assert.deepEqual(out.result.sources, []);
  assert.equal(out.generated, true, 'written by the model, labelled as AI');
  assert.deepEqual(searched, [], 'the mailbox was not searched');
  const [input] = tasks(calls);
  assert.equal(input.sources, undefined);
  assert.deepEqual(input.assistant, { model: 'ministral-3:3b', provider: 'ollama' });
});

test('a mailbox question: the model calls the search, only relevant mails reach the answer step', async t => {
  const { ask, calls, searched } = await setup(t, input =>
    input.sources
      ? { answer: 'Laut der Mail: **4.250 EUR**.', found: true, sources: ['s1'], quotes: [] }
      : { search: 'Angebot Preis' }
  );
  const out = await ask('Was kostet das Angebot?');
  // Meaning search: the words the model chose, with the question as context.
  assert.equal(searched.length, 1);
  assert.match(searched[0], /Angebot Preis$/, 'searched with the words the model chose');
  const [, second] = tasks(calls);
  assert.deepEqual(
    second.sources.map(s => s.subject),
    ['Angebot'],
    'the unrelated mail (similarity 0.3) is left out'
  );
  assert.equal(out.result.sources[0].uid, 7);
  assert.equal(out.generated, true);
});

test('relevance: a word of the question in the mail, or close enough in meaning', () => {
  assert.equal(relevant({ cosine: MIN_COSINE - 0.01 }), false);
  assert.equal(relevant({ cosine: MIN_COSINE }), true);
  assert.equal(relevant({ cosine: 0.1, wordHit: true }), true);
  assert.equal(relevant({ cosine: null, wordHit: false }), false);
});

test('nothing relevant at all: fixed text in the UI language, not labelled as AI-written', async t => {
  const { ai, calls } = await setup(t, input => (input.sources ? assert.fail('no second call') : { search: 'x' }));
  const handlers = {};
  registerAiRoutes({
    api: { get: () => {}, post: (p, ...rest) => (handlers[p] = rest.at(-1)) },
    ai,
    requireAction: () => true,
    accounts: () => [{ id: 'a1' }],
    ownAddresses: () => [],
    aiForgetHooks: [],
    semantic: {
      search: async () => [{ accountId: 'a1', folder: 'INBOX', uid: 8, subject: 'Storage', text: 'x', score: 0.2 }],
      sync: async () => null,
      forget: async () => {}
    }
  });
  const reply = { code: () => reply, send: x => x };
  for (const lang of ['de', 'en']) {
    calls.length = 0;
    const out = await handlers['/api/ai/run']({ body: { kind: 'ask', lang, input: { question: 'Vertrag?' } } }, reply);
    assert.equal(out.result.answer, notFound(lang));
    assert.equal(out.result.found, false);
    assert.deepEqual(out.result.sources, []);
    assert.equal(out.generated, false);
    assert.equal(tasks(calls).length, 1, 'only the decision step ran');
  }
  assert.match(notFound('en'), /found nothing/);
});

test('an answer cut off at the maximum length is passed on, "Weiter" asks again with more room', async t => {
  const { ask, calls } = await setup(t, () => ({
    answer: '',
    found: true,
    sources: [],
    truncated: true,
    maxTokens: 600
  }));
  const out = await ask('hi');
  assert.equal(out.result.truncated, true);
  assert.equal(out.result.maxTokens, 600);
  await ask('hi', { minTokens: 1200 });
  assert.equal(tasks(calls).at(-1).minTokens, 1200);
});

test('advanced model settings: limits follow memory and model, values are checked, reset removes them', () => {
  const small = modelLimits('ministral-3:3b', { totalBytes: 8 * GIB });
  const big = modelLimits('ministral-3:3b', { totalBytes: 64 * GIB });
  assert.equal(small.context.default, 8192);
  assert.ok(small.context.max < big.context.max, 'less memory, shorter maximum');
  assert.equal(big.context.max, CONTEXT_MAX);
  const cloud = modelLimits('claude-sonnet-5-5', { provider: 'anthropic', totalBytes: 64 * GIB });
  assert.equal(cloud.context, undefined, 'the provider decides the context of a cloud model');
  assert.equal(cloud.temperature, undefined, 'cloud reasoning models reject a temperature');

  const opts = { provider: 'ollama', totalBytes: 16 * GIB };
  assert.deepEqual(
    validateModelOptions(
      { contextLength: 16384, maxTokens: 2048, temperature: 0.234, thinking: 'off' },
      'ministral-3:3b',
      opts
    ),
    { contextLength: 16384, maxTokens: 2048, temperature: 0.23, thinking: 'off' }
  );
  assert.equal(validateModelOptions({ contextLength: null, thinking: 'auto' }, 'ministral-3:3b', opts), null);
  assert.throws(() => validateModelOptions({ contextLength: 999_999 }, 'ministral-3:3b', opts), /Kontextlänge/);
  assert.throws(() => validateModelOptions({ maxTokens: 10 }, 'ministral-3:3b', opts), /Antwortlänge/);
  assert.throws(() => validateModelOptions({ temperature: 3 }, 'ministral-3:3b', opts), /Temperatur/);
  assert.throws(() => validateModelOptions({ thinking: 'max' }, 'ministral-3:3b', opts), /Thinking/);

  const s = { ...DEFAULT_AI_SETTINGS, model: 'ministral-3:3b' };
  assert.deepEqual(effectiveModelOptions(s, 16 * GIB), {
    contextLength: 8192,
    maxTokens: null,
    temperature: null,
    thinking: 'auto'
  });
  // The mails of a question fit the context next to rules, question and answer.
  assert.equal(mailBudget({ contextLength: 8192, maxTokens: null }), (8192 - 1500 - 2500) * 3);
  assert.equal(mailBudget({ contextLength: null }), 60_000);
});

test('advanced settings are saved per model and reach the sidecar and the own Ollama', async t => {
  const { ai, calls } = await setup(t, () => ({ answer: 'ok', found: true, sources: [] }));
  const saved = await ai.save({ modelOptions: { model: 'ministral-3:3b', contextLength: 12288, thinking: 'off' } });
  assert.deepEqual(saved.modelOptions['ministral-3:3b'], { contextLength: 12288, thinking: 'off' });
  assert.equal(saved.effectiveOptions.contextLength, 12288);
  assert.ok(saved.modelLimits.context.max >= 12288);
  await ai.run('ask', { question: 'hi' });
  const configure = calls.filter(c => c.method === 'configure').at(-1);
  assert.deepEqual(configure.params.options, {
    contextLength: 12288,
    maxTokens: null,
    temperature: null,
    thinking: 'off'
  });
  const reset = await ai.save({ modelOptions: { model: 'ministral-3:3b' } });
  assert.equal(reset.modelOptions['ministral-3:3b'], undefined);
  assert.equal(
    ollamaEnv({ env: {}, home: '/h', models: '/m', port: 1, contextLength: 12288 }).OLLAMA_CONTEXT_LENGTH,
    '12288'
  );
  assert.equal(ollamaEnv({ env: {}, home: '/h', models: '/m', port: 1 }).OLLAMA_CONTEXT_LENGTH, undefined);
});

test('"how do I …": the model calls search_manual, only manual sections reach the answer, no mail search', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-assistant-manual-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const ai = createAiService({
    settingsFile: await createJsonFile(join(dir, 'ai.json'), DEFAULT_AI_SETTINGS),
    vault: { available: false },
    sidecar: {
      running: true,
      async call(method, params) {
        calls.push({ method, params });
        if (method !== 'task') return { ok: true };
        if (!params.input.manual) return { search: 'Abwesenheitsnotiz', tool: 'search_manual' };
        return { answer: 'Unter **Einstellungen → Konten**.', found: true, sources: ['m1'] };
      },
      async stop() {},
      diagnostics: () => ({})
    },
    log: createAiLog(join(dir, 'log.jsonl')),
    totalmem: () => 16 * GIB
  });
  await ai.save({ enabled: true, provider: 'ollama', model: 'ministral-3:3b' });
  const handlers = {};
  let mailSearched = false;
  registerAiRoutes({
    api: { get: () => {}, post: (p, ...rest) => (handlers[p] = rest.at(-1)) },
    ai,
    manual: {
      search: async () => [
        {
          chapterId: 'settings',
          number: '6.2',
          title: 'Abwesenheitsnotiz',
          chapter: 'Einstellungen',
          text: 'So geht es.'
        }
      ]
    },
    requireAction: () => true,
    accounts: () => [{ id: 'a1' }],
    ownAddresses: () => [],
    aiForgetHooks: [],
    semantic: {
      search: async () => {
        mailSearched = true;
        return [];
      },
      sync: async () => null,
      forget: async () => {}
    }
  });
  const reply = { code: () => reply, send: x => x };
  const out = await handlers['/api/ai/run'](
    { body: { kind: 'ask', lang: 'de', input: { question: 'Wie stelle ich eine Abwesenheitsnotiz ein?' } } },
    reply
  );
  assert.equal(mailSearched, false);
  const last = tasks(calls).at(-1);
  assert.deepEqual(last.sources, []);
  assert.equal(last.manual[0].id, 'm1');
  assert.equal(out.result.sources[0].manual, true);
  assert.equal(out.result.sources[0].section, '6.2');
});

test('a mailbox question gets no manual sections; a model without tool calls gets both', async t => {
  for (const [first, withManual] of [
    [{ search: 'Angebot', tool: 'search_mailbox' }, false],
    [{ search: 'Angebot', tool: 'search_mailbox', fallback: true }, true]
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'lv-assistant-nomanual-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const calls = [];
    const ai = createAiService({
      settingsFile: await createJsonFile(join(dir, 'ai.json'), DEFAULT_AI_SETTINGS),
      vault: { available: false },
      sidecar: {
        running: true,
        async call(method, params) {
          calls.push({ method, params });
          if (method !== 'task') return { ok: true };
          return 'sources' in params.input ? { answer: '4.250 EUR', found: true, sources: ['s1'] } : first;
        },
        async stop() {},
        diagnostics: () => ({})
      },
      log: createAiLog(join(dir, 'log.jsonl')),
      totalmem: () => 16 * GIB
    });
    await ai.save({ enabled: true, provider: 'ollama', model: 'ministral-3:3b' });
    const handlers = {};
    registerAiRoutes({
      api: { get: () => {}, post: (p, ...rest) => (handlers[p] = rest.at(-1)) },
      ai,
      manual: {
        search: async () => [
          { chapterId: 'mail', number: '3.1', title: 'Lesen', chapter: 'Mail', text: 'So liest du.' }
        ]
      },
      requireAction: () => true,
      accounts: () => [{ id: 'a1' }],
      ownAddresses: () => [],
      aiForgetHooks: [],
      semantic: {
        search: async () => [
          { accountId: 'a1', folder: 'INBOX', uid: 7, subject: 'Angebot', text: 'Preis 4.250 EUR', score: 0.8 }
        ],
        sync: async () => null,
        forget: async () => {}
      }
    });
    const reply = { code: () => reply, send: x => x };
    await handlers['/api/ai/run'](
      { body: { kind: 'ask', lang: 'de', input: { question: 'Was kostet das Angebot?' } } },
      reply
    );
    const last = tasks(calls).at(-1);
    assert.equal(last.sources.length, 1);
    assert.equal(last.manual.length, withManual ? 1 : 0);
  }
});
