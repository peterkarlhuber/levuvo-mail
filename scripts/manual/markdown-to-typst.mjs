// Converts the manual's Markdown (docs/manual/<lang>/*.md) into Typst markup for
// docs/manual/template/levuvo.typ. Only the subset the manual uses is supported, and anything
// else fails loudly so the PDF never silently drops content:
//   # / ## / ###, paragraphs, - and 1. lists (one nested level), | tables |, ![caption](file.png),
//   > **Tipp:** / > **Wichtig:** callouts, **bold**, *italic*, `keys` and [links](https://…),
//   :::columns / :::next / :::end for two columns, and {{name}} blocks filled in by the caller.

const SPECIAL = /[\\#$*_`<>@[\]~=/+\-"'^;]/g;
/** Escapes text so Typst shows it literally (also keeps // and "--" from turning into markup, and a ";" after #strong[…] from ending the call). */
export const esc = s => s.replace(SPECIAL, c => `\\${c}`);

const KEY_NAMES = new Set(['Strg', 'Ctrl', 'Enter', 'Entf', 'Delete', 'Del', 'Esc', 'Alt', 'Shift', '⌘', 'Tab']);
const isKey = s => KEY_NAMES.has(s) || s.length <= 2;

/** Inline markup: **bold**, *italic*, `key` or `code`, [text](url). */
export function inline(src) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m; (m = re.exec(src));) {
    out.push(esc(src.slice(last, m.index)));
    if (m[1] !== undefined) out.push(`#strong[${inline(m[1])}]`);
    else if (m[2] !== undefined) out.push(`#emph[${inline(m[2])}]`);
    else if (m[3] !== undefined) out.push(isKey(m[3]) ? `#key[${esc(m[3])}]` : `#mono[${esc(m[3])}]`);
    else out.push(`#link("${m[5]}")[${inline(m[4])}]`);
    last = re.lastIndex;
  }
  out.push(esc(src.slice(last)));
  if ((src.match(/\*\*/g) || []).length % 2 || (src.match(/`/g) || []).length % 2)
    throw new Error(`Unclosed inline markup: ${src}`);
  return out.join('');
}

function table(rows) {
  const split = r =>
    r
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(c => c.trim());
  const [head, sep, ...body] = rows;
  if (!sep || !/^\|?\s*:?-{3,}/.test(sep)) throw new Error(`Table without separator row: ${head}`);
  const cells = [split(head), ...body.map(split)];
  const n = cells[0].length;
  for (const r of cells) if (r.length !== n) throw new Error(`Table row with ${r.length} instead of ${n} cells: ${r}`);
  const longest = i => Math.max(...cells.map(r => r[i].length));
  const columns =
    n === 2
      ? longest(0) <= 28
        ? '(auto, 1fr)'
        : '(1fr, 1.6fr)'
      : `(${cells[0].map((_, i) => (longest(i) <= 16 ? 'auto' : '1fr')).join(', ')})`;
  const cell = c => `[${inline(c)}]`;
  // Tables stay on one page unless they hold a lot of text; those break with the header repeated.
  const breakable = cells.flat().join('').length > 1400;
  return [
    `#block(breakable: ${breakable}, width: 100%)[#table(columns: ${columns},`,
    `  table.header(${cells[0].map(cell).join(', ')}),`,
    ...cells.slice(1).map(r => `  ${r.map(cell).join(', ')},`),
    ')]'
  ].join('\n');
}

/**
 * @param {string} markdown
 * @param {{ image: (file: string) => string, blocks?: Record<string, string> }} options
 *   image maps a file name to the path Typst loads; blocks fills {{name}} lines with Typst markup.
 */
export function toTypst(markdown, { image, blocks = {} }) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let first = true;
  let sections = 0;
  const para = [];
  const flush = () => {
    if (para.length) out.push(inline(para.join(' ')), '');
    para.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      flush();
      i++;
    } else if ((m = /^(#{1,3}) (.+)$/.exec(line))) {
      flush();
      const level = m[1].length;
      // The first chapter of the manual ("Welcome") carries no number.
      const unnumbered = level === 1 && first && /^(Willkommen|Welcome)$/.test(m[2]);
      if (level === 1) first = false;
      if (level === 1) sections = 0;
      if (level === 2) sections++;
      out.push(
        unnumbered
          ? `#heading(level: 1, numbering: none, outlined: true)[${inline(m[2])}]`
          : `${'='.repeat(level)} ${inline(m[2])}`,
        ''
      );
      i++;
    } else if ((m = /^!\[([^\]]+)\]\(([^)]+)\)$/.exec(line.trim()))) {
      flush();
      const alt = m[1].replace(/[*`]/g, '').replace(/[\\"]/g, c => `\\${c}`);
      // In a chapter's first section the screenshot is usually on the chapter's title page.
      const opening = sections <= 1 ? ', opening: true' : '';
      out.push(`#shot("${image(m[2])}", "${alt}", [${inline(m[1])}]${opening})`, '');
      i++;
    } else if ((m = /^:::(columns|next|end)$/.exec(line.trim()))) {
      // :::columns … :::next … :::end sets content side by side (the shortcut page).
      flush();
      out.push({ columns: '#columns(2, gutter: 9mm)[', next: '#colbreak()', end: ']' }[m[1]], '');
      i++;
    } else if ((m = /^\{\{(\w+)\}\}$/.exec(line.trim()))) {
      flush();
      if (!(m[1] in blocks)) throw new Error(`Unknown block {{${m[1]}}}`);
      out.push(blocks[m[1]], '');
      i++;
    } else if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      out.push(table(rows), '');
    } else if (line.startsWith('>')) {
      flush();
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      const text = quote.join(' ');
      const c = /^\*\*([^*]+:)\*\*\s*(.*)$/.exec(text);
      if (!c) throw new Error(`Callout must start with **Label:** – ${text}`);
      const kind = /^(Wichtig|Important)/.test(c[1]) ? 'warn' : 'tip';
      out.push(`#callout("${kind}", [${inline(c[1])}], [${inline(c[2])}])`, '');
    } else if (/^\s*(- |\d+\. )/.test(line)) {
      flush();
      while (i < lines.length && /^\s*(- |\d+\. )|^\s{2,}\S/.test(lines[i]) && lines[i].trim()) {
        const item = /^(\s*)(- |\d+\. )(.*)$/.exec(lines[i]);
        if (!item) {
          // Continuation line of the previous item.
          out[out.length - 1] += ` ${inline(lines[i].trim())}`;
          i++;
          continue;
        }
        const depth = item[1].length >= 2 ? 1 : 0;
        const marker = item[2] === '- ' ? '-' : '+';
        out.push(`${'  '.repeat(depth)}${marker} ${inline(item[3])}`);
        i++;
      }
      out.push('');
    } else {
      if (/^\s{4,}|^```/.test(line)) throw new Error(`Unsupported Markdown: ${line}`);
      para.push(line.trim());
      i++;
    }
  }
  flush();
  return out.join('\n');
}
