// The user manual (docs/manual): German and English stay in step, every screenshot exists, and
// the Markdown converts to Typst without errors (scripts/manual/markdown-to-typst.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toTypst, inline, esc } from '../../../scripts/manual/markdown-to-typst.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const root0 = root;
const dir = lang => join(root, 'docs/manual', lang);
const chapters = lang =>
  readdirSync(dir(lang))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => readFileSync(join(dir(lang), f), 'utf8'));
const shape = md => ({
  h1: (md.match(/^# /gm) || []).length,
  h2: (md.match(/^## /gm) || []).length,
  images: [...md.matchAll(/!\[[^\]]+\]\(([^)]+)\)/g)].map(m => m[1]),
  blocks: [...md.matchAll(/^(\{\{\w+\}\}|:::\w+)$/gm)].map(m => m[1])
});

test('manual: German and English have the same chapters, sections and screenshots', () => {
  const de = chapters('de');
  const en = chapters('en');
  assert.equal(de.length, en.length);
  de.forEach((md, i) => assert.deepEqual(shape(en[i]), shape(md), `chapter ${i}`));
});

test('manual: every screenshot exists in both languages', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang))
      for (const file of shape(md).images)
        assert.ok(existsSync(join(root, 'docs/manual/img', lang, file)), `${lang}/${file}`);
});

test('manual: the product is always called "Levuvo Mail"', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang)) {
      const bare = md.match(/Levuvo(?![ -]Mail| Spaces)[^\n]{0,20}/g);
      assert.equal(bare, null, `${lang}: ${bare}`);
    }
});

test('manual: Markdown converts to Typst', () => {
  for (const lang of ['de', 'en'])
    for (const md of chapters(lang)) {
      const out = toTypst(md, { image: f => `/img/${f}`, blocks: { models: '#table()' } });
      assert.ok(out.length > 100);
      assert.doesNotMatch(out, /\{\{|^:::/m);
    }
});

test('manual converter: escaping, keys, links, lists and callouts', () => {
  assert.equal(esc('a*b_c #1 [x] // -- @me'), 'a\\*b\\_c \\#1 \\[x\\] \\/\\/ \\-\\- \\@me');
  assert.equal(inline('Press `Ctrl` + `K`'), 'Press #key[Ctrl] \\+ #key[K]');
  assert.equal(inline('File `Setup-x64.exe`'), 'File #mono[Setup\\-x64.exe]');
  assert.equal(inline('**Bold** and *it*'), '#strong[Bold] and #emph[it]');
  assert.equal(inline('[Site](https://example.org)'), '#link("https://example.org")[Site]');
  assert.throws(() => inline('**open'), /Unclosed/);
  const typ = toTypst('# Chapter\n\n1. One\n   - Sub\n2. Two\n\n> **Tip:** Hello', { image: f => f });
  assert.match(typ, /^= Chapter/m);
  assert.match(typ, /^\+ One\n {2}- Sub\n\+ Two/m);
  assert.match(typ, /#callout\("tip", \[Tip:\], \[Hello\]\)/);
  assert.match(toTypst('> **Wichtig:** x', { image: f => f }), /#callout\("warn"/);
  assert.match(toTypst('# Welcome', { image: f => f }), /numbering: none/);
  assert.throws(() => toTypst('```js', { image: f => f }), /Unsupported/);
  assert.throws(() => toTypst('| a | b |\n| c | d |', { image: f => f }), /separator/);
});

test('manual sections: numbering like the PDF, plain text without markup', async () => {
  const { parseManual, plainText, createManual } = await import('../src/manual.mjs');
  const chapters = parseManual([
    { name: '00-welcome.md', markdown: '# Welcome\n\nHello.\n' },
    {
      name: '01-start.md',
      markdown:
        '# Getting started\n\nIntro.\n\n## Back up your data\n\n1. Click **Save backup**.\n\n![Alt](x.png)\n\n## Quit\n\nUse `Ctrl` + `Q`.\n'
    }
  ]);
  assert.equal(chapters[0].number, null);
  assert.equal(chapters[1].number, 1);
  assert.deepEqual(
    chapters[1].sections.map(s => s.number),
    ['1', '1.1', '1.2']
  );
  assert.equal(chapters[1].sections[1].text, '1. Click Save backup.');
  assert.equal(plainText('| a | b |\n|---|---|\n| c | d |'), 'a – b\nc – d');

  // The real manual: both languages load, keyword search finds the backup section without a model.
  const manual = createManual();
  for (const lang of ['de', 'en']) assert.ok(manual.chapters(lang).length >= 8, lang);
  const [de] = await manual.search('Wie mache ich eine Sicherung?', { lang: 'de' });
  assert.match(de.title, /Sicher/);
  const [en] = await manual.search('How do I make a backup?', { lang: 'en' });
  assert.match(en.title, /back/i);
  assert.deepEqual(await manual.search('', { lang: 'de' }), []);
  assert.equal(manual.imagePath('de', '../secret.png'), null);
  assert.equal(manual.imagePath('xx', 'mail.png'), null);
  assert.ok(manual.imagePath('en', 'mail.png'));
});

test('manual search uses the embedding model and keeps vectors per model', async () => {
  const { createManual } = await import('../src/manual.mjs');
  const embeds = [];
  let model = 'm-a';
  const ai = {
    get: () => ({ enabled: true, features: {}, embedModel: model }),
    async run(kind, { texts }) {
      embeds.push(texts.length);
      // One dimension per word "backup"/"sicherung": the question and the backup section line up.
      return { vectors: texts.map(t => [/backup|sicher/i.test(t) ? 1 : 0, 0.1]) };
    }
  };
  const root = join(root0, 'docs/manual');
  const manual = createManual({ root, ai });
  const hits = await manual.search('backup', { lang: 'en' });
  assert.ok(hits.length > 0);
  const first = embeds.length;
  await manual.search('backup again', { lang: 'en' });
  assert.equal(embeds.length, first + 1, 'sections are not embedded twice');
  model = 'm-b';
  await manual.search('backup', { lang: 'en' });
  assert.ok(embeds.length > first + 2, 'a model change embeds the sections again');
  // A failing model falls back to word matching.
  ai.run = async () => {
    throw new Error('not downloaded');
  };
  model = 'm-c';
  assert.ok((await manual.search('backup', { lang: 'en' })).length > 0);
});

test('ask: matching manual sections go to the model and come back as manual sources', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { createJsonFile } = await import('../src/app.mjs');
  const { createAiService, createAiLog, DEFAULT_AI_SETTINGS } = await import('../src/ai-service.mjs');
  const { registerAiRoutes } = await import('../src/routes-ai.mjs');
  const { createManual } = await import('../src/manual.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lv-manual-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const m = new Map();
  const ai = createAiService({
    settingsFile: await createJsonFile(join(dir, 'ai.json'), DEFAULT_AI_SETTINGS),
    vault: {
      available: true,
      get: (i, k) => m.get(`${i}:${k}`) || '',
      set: (i, k, v) => m.set(`${i}:${k}`, v),
      delete: () => {}
    },
    sidecar: {
      running: true,
      async call(method, params) {
        calls.push({ method, params });
        return method === 'task' ? { answer: 'ok', found: true, sources: ['m1', 's1'] } : { ok: true };
      },
      async stop() {},
      diagnostics: () => ({})
    },
    log: createAiLog(join(dir, 'log.jsonl'))
  });
  // The stub has no embeddings, so the manual search falls back to word matching.
  await ai.save({ enabled: true });
  const handlers = {};
  registerAiRoutes({
    api: { get: (p, ...r) => (handlers[`GET ${p}`] = r.at(-1)), post: (p, ...r) => (handlers[`POST ${p}`] = r.at(-1)) },
    ai,
    manual: createManual(),
    requireAction: () => true,
    accounts: () => [{ id: 'a' }],
    ownAddresses: () => [],
    aiForgetHooks: [],
    semantic: {
      search: async () => [{ accountId: 'a', folder: 'INBOX', uid: 7, subject: 'S', text: 'T' }],
      sync: async () => null,
      forget: async () => {}
    }
  });
  const reply = { code: () => reply, send: x => x };
  const out = await handlers['POST /api/ai/run'](
    {
      body: {
        kind: 'ask',
        lang: 'de',
        input: { question: 'Wie erstelle ich eine Sicherung?' },
        manualMap: [{ manual: true, chapterId: 'x' }]
      }
    },
    reply
  );
  const task = calls.find(c => c.method === 'task');
  assert.ok(task, JSON.stringify(out));
  const sent = JSON.stringify(task.params);
  assert.match(sent, /"m1"/);
  assert.match(sent, /Sicherung/);
  assert.equal(out.result.sources[0].manual, true);
  assert.notEqual(out.result.sources[0].chapterId, 'x', 'the client cannot inject manual sources');
  assert.match(out.result.sources[0].section, /^\d+\.\d+$/);
  assert.equal(out.result.sources[1].uid, 7);
});

test('manual follows the app language, with its own index per language and a fallback', async t => {
  const { createManual } = await import('../src/manual.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const embedded = [];
  const ai = {
    get: () => ({ enabled: true, features: {}, embedModel: 'm' }),
    async run(kind, { texts }) {
      embedded.push(...texts);
      return { vectors: texts.map(x => [/sicherung|backup/i.test(x) ? 1 : 0, 0.1]) };
    }
  };
  const manual = createManual({ ai });
  const [de] = await manual.search('Sicherung', { lang: 'de' });
  const [en] = await manual.search('backup', { lang: 'en' });
  assert.match(de.chapter, /Erste Schritte/);
  assert.match(en.chapter, /Getting started/);
  const count = embedded.length;
  // Switching back and forth uses the vectors already built for each language.
  await manual.search('Sicherung', { lang: 'de' });
  await manual.search('backup', { lang: 'en' });
  assert.equal(embedded.length, count + 2, 'only the two questions are embedded');

  // A language without a manual shows the other one instead of an empty help view.
  const dir = mkdtempSync(join(tmpdir(), 'lv-manual-lang-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'de'));
  writeFileSync(join(dir, 'de', '01-a.md'), '# Erste Schritte\n\n## Sicherung\n\nText.\n');
  const fallback = createManual({ root: dir });
  assert.equal(fallback.chapters('en')[0].title, 'Erste Schritte');
});
