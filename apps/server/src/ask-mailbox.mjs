// "Ask your mailbox": finds the mails that can answer a question and prepares them for the model.
//
// Retrieval is hybrid: search by meaning (vectors of the local model) and by words (the encrypted
// full-text index) are merged with reciprocal rank fusion. Words catch names, numbers and rare
// terms ("Müller", "RE-2026-114") that meaning alone misses; meaning catches paraphrases. When
// vectors are not built yet, words alone still answer. The best few hits are then read in full,
// with the text of their attachments, so the answer is not limited to the start of a mail.

import { normalize } from './local-index.mjs';

const RRF_K = 60;
const MAX_TERMS = 5;

// Question words and fillers in German and English; they never narrow a search.
const STOP = new Set(
  (
    'aber alle allem als also am an auch auf aus bei beim bin bis bitte da damit dann das dass dem den der des die ' +
    'dies diese dieser doch du ein eine einem einen einer er es etwas für gab gibt habe haben hat hatte hast ich ' +
    'ihm ihn ihr im in ins ist ja jetzt kann kannst kein letzte letzten letzter mal man mein meine mich mir mit ' +
    'nach nicht noch nun nur ob oder schon sein seit sich sie sind so soll über um und uns unser von vom vor war ' +
    'waren was weißt welche welcher welches wenn wer wie wieder wieviel wann warum wo woher wohin wurde wurden zu ' +
    'zum zur zwischen sagte sagt gesagt geschrieben schrieb schreibt mails mail email e-mail nachricht ' +
    'about after all also and any are ask did does for from had has have how into is it its last me my of on or ' +
    'said say says tell than that the their them then there this to told was we were what when where which who ' +
    'why will with wrote you your'
  ).split(' ')
);

/** Search words of a question: names, numbers and content words, most specific first. */
export function questionTerms(question) {
  const seen = new Set();
  const out = [];
  const raw = String(question || '')
    .replace(/[„“”"'’‚‘«»()[\]{}<>?!.,;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const word of raw) {
    const n = normalize(word);
    if (n.length < 3 || STOP.has(n) || STOP.has(word.toLowerCase()) || seen.has(n)) continue;
    seen.add(n);
    // Capitalised words in the middle of a sentence (names in English, nouns and names in
    // German), digits and mixed tokens are the most selective.
    const specific = /\d/.test(word) || /[A-ZÄÖÜ]/.test(word.slice(1)) || /^[A-ZÄÖÜ]/.test(word);
    out.push({ word, specific, length: n.length });
  }
  out.sort((a, b) => Number(b.specific) - Number(a.specific) || b.length - a.length);
  return out.slice(0, MAX_TERMS).map(t => t.word);
}

const keyOf = h => `${h.accountId}\u0000${h.folder}\u0000${h.uid}`;

/** Reciprocal rank fusion of ranked lists; a mail found by several lists rises to the top. */
export function fuse(lists, limit) {
  const merged = new Map();
  for (const { hits, weight = 1 } of lists)
    hits.forEach((h, rank) => {
      const k = keyOf(h);
      const prev = merged.get(k);
      const add = weight / (RRF_K + rank + 1);
      if (prev) prev.score += add;
      else merged.set(k, { ...h, score: add });
    });
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)))
    .slice(0, limit);
}

/**
 * The best mails for a question, across accounts.
 * @param {object} o
 * @param {object} o.semantic    semantic index (search)
 * @param {object} o.localIndex  local index (search, text)
 * @param {string[]} o.ids       accounts to search
 * @param {string} o.question
 * @param {string} [o.context]   earlier question of a follow-up, widens the search
 */
export async function retrieve({ semantic, localIndex, ids, question, context = '', limit = 8 }) {
  if (!ids.length) return [];
  const query = context ? `${context} ${question}` : question;
  const lists = [];
  const meaning = await semantic?.search(ids, query, { limit: 16 }).catch(() => []);
  if (meaning?.length) lists.push({ hits: meaning, weight: 1 });
  if (localIndex?.search) {
    const terms = questionTerms(question);
    for (const extra of context ? questionTerms(context).slice(0, 2) : [])
      if (!terms.includes(extra)) terms.push(extra);
    // Each word on its own (an AND of all of them is usually empty for a question), plus the
    // pair of the two most specific words, which counts extra.
    if (terms.length > 1)
      lists.push({
        hits: await localIndex.search(ids, `${terms[0]} ${terms[1]}`, { limit: 12 }).catch(() => []),
        weight: 1.5
      });
    for (const term of terms)
      lists.push({ hits: await localIndex.search(ids, term, { limit: 12 }).catch(() => []), weight: 0.8 });
  }
  const fused = fuse(
    lists.filter(l => l.hits.length),
    limit
  );
  const out = [];
  for (const h of fused) {
    const item = h.text === undefined ? await localIndex?.text?.(h.accountId, h.folder, h.uid).catch(() => null) : h;
    if (item) out.push({ ...h, ...item, score: h.score });
  }
  return out;
}

/**
 * Reads the best hits in full (body and attachment text). `load(hit)` returns the message detail,
 * `attachments(hit)` the attachment texts; a failure keeps the index text of that hit.
 */
export async function readSources(hits, { load, attachments, full = 5, mapLimit }) {
  return mapLimit(hits, 3, async (h, i) => {
    const base = { ...h, attachments: [] };
    if (i >= full) return base;
    const [detail, files] = await Promise.all([
      load(h).catch(() => null),
      h.hasAttachments === false ? [] : attachments(h).catch(() => [])
    ]);
    return { ...base, text: detail?.text || h.text, to: detail?.to || '', attachments: files || [] };
  });
}

const fold = s =>
  normalize(String(s || ''))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Keeps a quote only if it really occurs in its source (body or attachment), so a quote shown
 * under an answer is always a literal passage of that mail.
 */
export function verifiedQuote(quote, source) {
  const q = fold(quote);
  if (q.length < 8) return '';
  const hay = fold([source.text, ...(source.attachments || []).map(a => a.text)].join('\n'));
  return hay.includes(q) ? String(quote).trim().slice(0, 300) : '';
}
