// Temporary research: mDenseOn as GGUF in Levuvo's pinned Ollama, on the German test set, with
// different prompt variants (query/document prefixes).
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('scripts/ollama/embed-eval-de.json', 'utf8'));
const url = 'http://127.0.0.1:11434';
async function embed(model, input) {
  const res = await fetch(`${url}/api/embed`, { method: 'POST', body: JSON.stringify({ model, input }) });
  if (!res.ok) throw new Error(`${model}: ${res.status} ${await res.text()}`);
  return (await res.json()).embeddings;
}
const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
for (const [model, qp, dp] of [
  ['mdenseon', '', ''],
  ['mdenseon', 'query: ', ''],
  ['mdenseon', 'query: ', 'document: '],
  ['bge-m3', '', '']
]) {
  try {
    const t0 = Date.now();
    const docs = (await embed(model, data.mails.map(m => `${dp}${m.subject}\n${m.from}\n${m.text}`))).map(norm);
    const ms = Math.round((Date.now() - t0) / data.mails.length);
    const qs = (await embed(model, data.queries.map(q => qp + q.q))).map(norm);
    let r1 = 0, r3 = 0, mrr = 0;
    data.queries.forEach((q, i) => {
      const ranked = docs.map((d, j) => ({ id: data.mails[j].id, s: dot(qs[i], d) })).sort((a, b) => b.s - a.s).map(x => x.id);
      const rank = Math.min(...q.relevant.map(id => ranked.indexOf(id))) + 1;
      if (rank === 1) r1++; if (rank <= 3) r3++; mrr += 1 / rank;
    });
    const n = data.queries.length;
    console.log(`RESULT ${model} q=${JSON.stringify(qp)} d=${JSON.stringify(dp)} dims=${docs[0].length} R@1=${r1}/${n} R@3=${r3}/${n} MRR=${(mrr / n).toFixed(3)} ms/mail=${ms}`);
  } catch (e) {
    console.log(`FAILED ${model} ${qp} ${dp}: ${e.message}`);
  }
}
// Long input (context check): ~6000 words.
try {
  const long = 'Rechnung Lieferung Termin Angebot '.repeat(1500);
  const e = await embed('mdenseon', [long]);
  console.log('LONG ok dims', e[0].length);
} catch (e) { console.log('LONG failed', e.message); }
