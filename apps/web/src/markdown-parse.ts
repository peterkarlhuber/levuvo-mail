// Parsing of the small Markdown subset the assistant writes (see Markdown.tsx), without React, so it
// can be tested in Node. Produces paragraphs, lists and inline tokens; never HTML.

export type List = { kind: 'ul' | 'ol'; items: string[] };
export type Para = { kind: 'p'; lines: string[] };
export type Block = Para | List;

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Splits text into paragraphs and lists. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // Kept in an object: TypeScript does not see the reset inside flush() on a plain variable.
  const st: { cur: Block | null } = { cur: null };
  const flush = () => {
    if (st.cur) blocks.push(st.cur);
    st.cur = null;
  };
  for (const raw of String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    if (!raw.trim() || RULE.test(raw)) {
      flush();
      continue;
    }
    const item = (BULLET.exec(raw) || NUMBER.exec(raw))?.[1];
    if (item !== undefined) {
      const kind = BULLET.test(raw) ? 'ul' : 'ol';
      const list: List = st.cur && st.cur.kind === kind ? st.cur : { kind, items: [] };
      if (list !== st.cur) {
        flush();
        st.cur = list;
      }
      list.items.push(item);
      continue;
    }
    // An indented line after a list item continues that item.
    if (st.cur && st.cur.kind !== 'p' && /^\s{2,}\S/.test(raw)) {
      st.cur.items[st.cur.items.length - 1] += `\n${raw.trim()}`;
      continue;
    }
    const heading = HEADING.exec(raw);
    const line = heading ? `**${heading[1]}**` : raw.trim();
    const para: Para = st.cur && st.cur.kind === 'p' ? st.cur : { kind: 'p', lines: [] };
    if (para !== st.cur) {
      flush();
      st.cur = para;
    }
    para.lines.push(line);
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+?)`|\*([^*\s][^*\n]*?)\*|_([^_\s][^_\n]*?)_)/g;

export type Token = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };

/** **bold**, *italic* and `code` within one line. */
export function inlineTokens(text: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    // `_` only marks emphasis at word boundaries (not in snake_case or file_names).
    if (m[6] !== undefined && (/\w/.test(text[at - 1] || '') || /\w/.test(text[at + m[0].length] || ''))) continue;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[2] !== undefined || m[3] !== undefined) out.push({ kind: 'strong', text: m[2] ?? m[3] });
    else if (m[4] !== undefined) out.push({ kind: 'code', text: m[4] });
    else out.push({ kind: 'em', text: m[5] ?? m[6] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
