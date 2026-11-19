// Builds the user manual as an accessible PDF (PDF/UA-1, tagged) with Typst.
//   pip install typst==0.14.8   (or a typst CLI ≥ 0.14 on PATH)
//   node scripts/manual/build-pdf.mjs [--lang de|en] [--out dist/manual]
// Input: docs/manual/<lang>/*.md in file name order, screenshots from docs/manual/img/<lang>/
// (scripts/manual/capture-screenshots.mjs), the design in docs/manual/template/levuvo.typ.
// Output: <out>/Levuvo-Mail-Handbuch-<version>.pdf (de), Levuvo-Mail-Manual-<version>.pdf (en).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { toTypst, inline } from './markdown-to-typst.mjs';
import { MODEL_CATALOG, MODEL_TIERS } from '../../apps/server/src/ai-model-catalog.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({
  options: { lang: { type: 'string', multiple: true }, out: { type: 'string', default: 'dist/manual' } }
});
const languages = args.lang?.length ? args.lang : ['de', 'en'];
const outDir = resolve(root, args.out);
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const TEXT = {
  de: {
    title: 'Benutzerhandbuch',
    subtitle: 'E-Mail, Kalender, Kontakte, Aufgaben, Räume und KI-Assistent|für macOS und Windows',
    back: 'Alles läuft auf deinem Computer. Deine Nachrichten und Passwörter gehen nie über einen Server von Levuvo Mail.',
    toc: 'Inhalt',
    running: 'Benutzerhandbuch',
    version: `Version ${version}`,
    file: `Levuvo-Mail-Handbuch-${version}.pdf`,
    coverAlt: 'Levuvo Mail mit Posteingang und geöffneter Nachricht',
    tier: { small: 'Klein', standard: 'Standard', large: 'Groß' },
    head: ['Größe', 'Modell', 'Anbieter', 'Download'],
    recommended: 'empfohlen',
    search: 'Suche',
    month: d => d.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })
  },
  en: {
    title: 'User manual',
    subtitle: 'Email, calendar, contacts, tasks, spaces and AI assistant|for macOS and Windows',
    back: 'Everything runs on your computer. Your messages and passwords never pass through a Levuvo Mail server.',
    toc: 'Contents',
    running: 'User manual',
    version: `Version ${version}`,
    file: `Levuvo-Mail-Manual-${version}.pdf`,
    coverAlt: 'Levuvo Mail showing the inbox with an open message',
    tier: { small: 'Small', standard: 'Standard', large: 'Large' },
    head: ['Size', 'Model', 'Vendor', 'Download'],
    recommended: 'recommended',
    search: 'Search',
    month: d => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }
};

/** The model table comes from the catalog the app uses, so it can never drift. */
function modelsTable(lang) {
  const t = TEXT[lang];
  const gb = n => `${(n / 1e9).toFixed(1).replace('.', lang === 'de' ? ',' : '.')} GB`;
  const rows = MODEL_CATALOG.filter(m => m.kind === 'chat').map(m => {
    const tags = [m.default ? t.recommended : '', m.eu ? 'EU' : ''].filter(Boolean);
    return [
      `${t.tier[m.tier]} (${MODEL_TIERS[m.tier].minRamGb} GB RAM)`,
      `**${m.name}**${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
      m.vendor,
      gb(m.size)
    ];
  });
  const cell = c => `[${inline(c)}]`;
  return [
    '#block(breakable: false, width: 100%)[#table(columns: (auto, 1fr, auto, auto),',
    `  table.header(${t.head.map(cell).join(', ')}),`,
    ...rows.map(r => `  ${r.map(cell).join(', ')},`),
    ')]'
  ].join('\n');
}

function findTypst() {
  const cli = spawnSync('typst', ['--version'], { encoding: 'utf8' });
  if (cli.status === 0 && /typst 0\.(1[4-9]|[2-9]\d)/.test(cli.stdout)) return 'cli';
  const py = spawnSync('python3', ['-c', 'import typst'], { encoding: 'utf8' });
  if (py.status === 0) return 'python';
  throw new Error('Typst is missing: pip install typst==0.14.8 (or install the typst CLI ≥ 0.14).');
}

function compile(engine, input, output) {
  const fonts = ['/usr/share/fonts/opentype/inter', '/usr/share/fonts/truetype/inter'].filter(existsSync);
  const res =
    engine === 'cli'
      ? spawnSync(
          'typst',
          [
            'compile',
            '--root',
            root,
            '--pdf-standard',
            'ua-1',
            ...fonts.flatMap(f => ['--font-path', f]),
            input,
            output
          ],
          { encoding: 'utf8' }
        )
      : spawnSync(
          'python3',
          [
            '-I',
            '-c',
            'import sys, typst; typst.compile(sys.argv[1], output=sys.argv[2], root=sys.argv[3], font_paths=sys.argv[4:], pdf_standards="ua-1")',
            input,
            output,
            root,
            ...fonts
          ],
          { encoding: 'utf8' }
        );
  if (res.status !== 0) throw new Error(`Typst failed:\n${res.stderr || res.stdout}`);
  if (res.stderr?.trim()) process.stderr.write(res.stderr);
}

const engine = findTypst();
mkdirSync(outDir, { recursive: true });
const work = join(root, 'docs/manual/.build');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

for (const lang of languages) {
  const t = TEXT[lang];
  const srcDir = join(root, 'docs/manual', lang);
  const files = readdirSync(srcDir)
    .filter(f => f.endsWith('.md'))
    .sort();
  const imgDir = join(root, 'docs/manual/img', lang);
  const image = file => {
    const path = join(imgDir, file);
    if (!existsSync(path)) throw new Error(`${lang}: screenshot ${file} is missing (run capture-screenshots.mjs)`);
    return '/' + relative(root, path);
  };
  const body = files
    .map(f => {
      try {
        return toTypst(readFileSync(join(srcDir, f), 'utf8'), { image, blocks: { models: modelsTable(lang) } });
      } catch (e) {
        throw new Error(`${lang}/${f}: ${e.message}`, { cause: e });
      }
    })
    .join('\n\n');
  const main = [
    '#import "/docs/manual/template/levuvo.typ": *',
    '#show: manual.with(',
    `  lang: "${lang}",`,
    `  title: "${t.title}",`,
    `  subtitle: "${t.subtitle}",`,
    `  version: "${t.version}",`,
    `  date: "${t.month(new Date())}",`,
    `  toc-title: "${t.toc}",`,
    `  running: "${t.running}",`,
    `  cover-shot: "${image('cover.png')}",`,
    `  cover-alt: "${t.coverAlt}",`,
    `  cover: "${process.env.MANUAL_COVER || 'night'}",`,
    `  shot-style: "${process.env.MANUAL_SHOT || 'fade'}",`,
    `  back: "${t.back}",`,
    ')',
    '',
    body
  ].join('\n');
  const input = join(work, `${lang}.typ`);
  writeFileSync(input, main);
  const output = join(outDir, t.file);
  compile(engine, input, output);
  console.log(`✓ ${relative(root, output)}`);
}
