// The user manual (docs/manual/<lang>/*.md) inside the app: chapters for the help view and
// short sections the assistant can answer "how do I …" questions from.
//
// Sections are the "##" parts of each chapter, numbered like the PDF (the welcome chapter has no
// number). The assistant search embeds them with the same local model as the mail search; vectors
// are kept per embedding model and content hash, so a model change never mixes old and new
// vectors and only the few manual sections are embedded again. Without a usable model the search
// falls back to matching words.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeVector } from './ai-semantic.mjs';
import { queryPrefixFor } from './ai-model-catalog.mjs';

export const MANUAL_LANGS = ['de', 'en'];
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/manual');
const IMAGE = /^[a-z0-9-]+\.png$/;

/** Plain text of a Markdown section for search and for the model (no markup, no images). */
export function plainText(md) {
  return md
    .split('\n')
    .filter(l => !/^!\[|^:::|^\{\{|^\|\s*-{3}/.test(l.trim()))
    .map(l =>
      l
        .replace(/^#{1,3} /, '')
        .replace(/^>\s?/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^\|\s*|\s*\|$/g, '')
        .replace(/\s*\|\s*/g, ' – ')
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Chapters and sections of one language. */
export function parseManual(files) {
  const chapters = [];
  let number = 0;
  for (const { name, markdown } of files) {
    const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim() || name;
    const numbered = chapters.length > 0 || !/^(Willkommen|Welcome)$/.test(title);
    if (numbered) number++;
    const chapter = { id: name.replace(/\.md$/, ''), number: numbered ? number : null, title, markdown, sections: [] };
    const parts = markdown.split(/^(?=## )/m);
    // The text before the first "##" belongs to the chapter itself.
    const intro = parts[0].replace(/^# .+$/m, '').trim();
    if (intro)
      chapter.sections.push({ number: chapter.number ? String(chapter.number) : '', title, text: plainText(intro) });
    parts.slice(1).forEach((part, i) => {
      const heading = /^## (.+)$/m.exec(part)[1].trim();
      chapter.sections.push({
        number: chapter.number ? `${chapter.number}.${i + 1}` : '',
        title: heading,
        text: plainText(part.replace(/^## .+$/m, ''))
      });
    });
    chapters.push(chapter);
  }
  return chapters;
}

const fold = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const STOP = new Set(
  'der die das und oder ein eine einen einem einer ich du wie was wo wann kann man mit in im auf an zu für von ist sind wird mein meine dein deine the a an and or to of in on for is are how what where when can i my do does it with'.split(
    ' '
  )
);
const words = s =>
  fold(s)
    .match(/[a-z0-9]{2,}/g)
    ?.filter(w => !STOP.has(w)) || [];

/** Word-match score, used when no embedding model is available. */
function keywordScore(query, section) {
  const q = new Set(words(query));
  if (!q.size) return 0;
  const title = new Set(words(section.title));
  const body = words(section.text);
  let score = 0;
  for (const w of q) {
    // Prefix match so "Sicherung" also finds "Sicherungen", "backup" finds "backups".
    const inTitle = [...title].some(t => t.startsWith(w) || w.startsWith(t));
    const inBody = body.filter(t => t.startsWith(w) || (t.length > 4 && w.startsWith(t))).length;
    score += (inTitle ? 3 : 0) + Math.min(inBody, 3);
  }
  return score / q.size;
}

/**
 * @param {object} o
 * @param {string} [o.root] docs/manual
 * @param {object} [o.ai]   AI service (get, run) for embeddings
 */
export function createManual({ root = DEFAULT_ROOT, ai = null } = {}) {
  const cache = new Map(); // lang -> chapters
  const vectors = new Map(); // `${model}\0${lang}\0${hash}` -> Float32Array[]

  const read = l => {
    const dir = path.join(root, l);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter(f => f.endsWith('.md'))
          .sort()
          .map(name => ({ name, markdown: readFileSync(path.join(dir, name), 'utf8') }))
      : [];
  };
  /** The manual in the app's language; a language without a manual falls back to the other one. */
  function chapters(lang) {
    const l = MANUAL_LANGS.includes(lang) ? lang : 'de';
    if (!cache.has(l)) {
      let files = read(l);
      if (!files.length) files = read(MANUAL_LANGS.find(x => x !== l));
      cache.set(l, parseManual(files));
    }
    return cache.get(l);
  }
  const sections = lang =>
    chapters(lang).flatMap(c => c.sections.map(s => ({ ...s, chapter: c.title, chapterId: c.id })));

  async function sectionVectors(lang, model) {
    const list = sections(lang);
    const hash = createHash('sha256')
      .update(list.map(s => s.title + s.text).join('\0'))
      .digest('hex')
      .slice(0, 16);
    const key = `${model}\u0000${lang}\u0000${hash}`;
    if (!vectors.has(key)) {
      // Only the current model's vectors are kept.
      for (const k of vectors.keys()) if (k.split('\u0000')[1] === lang) vectors.delete(k);
      const out = [];
      for (let i = 0; i < list.length; i += 32) {
        const texts = list.slice(i, i + 32).map(s => `${s.chapter} – ${s.title}\n${s.text}`.slice(0, 2000));
        const r = await ai.run('embed', { texts }, { source: 'index' });
        out.push(...r.vectors.map(v => normalizeVector(v)));
      }
      vectors.set(key, out);
    }
    return { list, vecs: vectors.get(key) };
  }

  /** The sections that fit a question best (at most `limit`), with a score. */
  async function search(question, { lang = 'de', limit = 3 } = {}) {
    const q = String(question || '')
      .trim()
      .slice(0, 500);
    if (!q) return [];
    const s = ai?.get?.();
    const model = s?.enabled && s.features?.search !== false ? s.embedModel : null;
    if (model) {
      try {
        const { list, vecs } = await sectionVectors(lang, model);
        const [raw] = (await ai.run('embed', { texts: [queryPrefixFor(model) + q] }, { source: 'index' })).vectors;
        const qv = normalizeVector(raw);
        return list
          .map((sec, i) => {
            let score = 0;
            for (let k = 0; k < qv.length; k++) score += qv[k] * (vecs[i][k] || 0);
            return { ...sec, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .filter(x => x.score > 0.3);
      } catch {
        // Model not downloaded or Ollama not running: match words instead.
      }
    }
    return sections(lang)
      .map(sec => ({ ...sec, score: keywordScore(q, sec) }))
      .filter(x => x.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** A screenshot file of the manual, or null. Only plain names from docs/manual/img/<lang>/. */
  // The path comes from the directory listing, never from the request: a name that is not in
  // docs/manual/img/<lang>/ simply has no entry.
  const images = new Map(); // lang -> Map(file -> path)
  function imagePath(lang, file) {
    const l = MANUAL_LANGS.find(x => x === lang);
    if (!l || typeof file !== 'string' || !IMAGE.test(file)) return null;
    if (!images.has(l)) {
      const dir = path.join(root, 'img', l);
      const list = existsSync(dir) ? readdirSync(dir).filter(f => IMAGE.test(f)) : [];
      images.set(l, new Map(list.map(f => [f, path.join(dir, f)])));
    }
    return images.get(l).get(file) || null;
  }

  return { chapters, sections, search, imagePath };
}
