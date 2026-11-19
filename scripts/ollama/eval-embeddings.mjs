#!/usr/bin/env node
// Compares embedding models for Levuvo's semantic search on a German test mailbox.
//   node scripts/ollama/eval-embeddings.mjs [--url http://127.0.0.1:11434] model[,noprefix] ...
// Each query is embedded with Levuvo's query instruction (unless ",noprefix" is given), each mail as
// Levuvo embeds it (subject, sender, text). Reports recall@1, recall@3 and the mean reciprocal rank.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const QUERY_PREFIX = 'Instruct: Given a search query, retrieve relevant emails that answer it\nQuery: ';
const args = process.argv.slice(2);
let url = 'http://127.0.0.1:11434';
if (args[0] === '--url') {
  url = args[1];
  args.splice(0, 2);
}
const data = JSON.parse(readFileSync(join(import.meta.dirname, 'embed-eval-de.json'), 'utf8'));

async function embed(model, input) {
  const res = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input })
  });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  return (await res.json()).embeddings;
}
const norm = v => {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function evaluate(spec) {
  const [model, flag] = spec.split(',');
  const prefix = flag === 'noprefix' ? '' : QUERY_PREFIX;
  const t0 = Date.now();
  const docs = (await embed(model, data.mails.map(m => `${m.subject}\n${m.from}\n${m.text}`))).map(norm);
  const docMs = Date.now() - t0;
  const qs = (await embed(model, data.queries.map(q => prefix + q.q))).map(norm);
  let r1 = 0;
  let r3 = 0;
  let mrr = 0;
  const misses = [];
  data.queries.forEach((q, i) => {
    const ranked = docs
      .map((d, j) => ({ id: data.mails[j].id, s: dot(qs[i], d) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.id);
    const rank = Math.min(...q.relevant.map(id => ranked.indexOf(id))) + 1;
    if (rank === 1) r1 += 1;
    if (rank <= 3) r3 += 1;
    mrr += 1 / rank;
    if (rank > 1) misses.push(`${q.q} -> rank ${rank} (top: ${ranked[0]})`);
  });
  const n = data.queries.length;
  return {
    model: spec,
    dims: docs[0].length,
    recall1: +(r1 / n).toFixed(3),
    recall3: +(r3 / n).toFixed(3),
    mrr: +(mrr / n).toFixed(3),
    msPerMail: Math.round(docMs / data.mails.length),
    misses
  };
}

if (/eval-embeddings\.mjs$/.test(process.argv[1] || '')) {
  for (const spec of args) {
    const r = await evaluate(spec);
    console.log(`RESULT ${JSON.stringify({ ...r, misses: undefined })}`);
    for (const m of r.misses) console.log(`  miss: ${m}`);
  }
}
