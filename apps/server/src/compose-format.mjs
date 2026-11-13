// Converts the composer's plain text with light formatting into a safe HTML part.
// Supported: **fett**, _kursiv_, [Text](https://…), automatische Links, Listen
// ("- " / "1. "), Zitate ("> "). All input is HTML-escaped first, so no markup
// from the user (or from quoted mails) can reach the HTML part unescaped.

const escapeHtml = value =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;

function inline(escaped) {
  const links = [];
  const keep = html => `\u0000${links.push(html) - 1}\u0000`;
  let out = escaped.replace(/\[([^\]\n]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s()]{1,2000})\)/gi, (_m, text, url) =>
    keep(`<a href="${url}">${text}</a>`)
  );
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<]{2,2000}?)(?=[.,;:!?)]*(?:\s|$))/gi, (_m, lead, url) =>
    SAFE_URL.test(url) ? `${lead}${keep(`<a href="${url}">${url}</a>`)}` : _m
  );
  out = out
    .replace(/\*\*(?=\S)([^*\n]{1,500}?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_(?=\S)([^_\n]{1,500}?)(?<=\S)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)]);
}

function paragraphs(lines) {
  const html = [];
  let buffer = [];
  let list = null;
  const flushParagraph = () => {
    if (buffer.length) html.push(`<p style="margin:0 0 12px">${buffer.map(inline).join('<br>')}</p>`);
    buffer = [];
  };
  const flushList = () => {
    if (list)
      html.push(
        `<${list.tag} style="margin:0 0 12px;padding-left:22px">${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`
      );
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*&gt;/.test(line)) {
      flushParagraph();
      flushList();
      const quoted = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*&gt; ?/, ''));
        i++;
      }
      i--;
      html.push(
        `<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #c8c8c8;color:#555">${paragraphs(quoted)}</blockquote>`
      );
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    buffer.push(line);
  }
  flushParagraph();
  flushList();
  return html.join('');
}

export function textToHtml(text) {
  const lines = escapeHtml(String(text || ''))
    .replace(/\r\n?/g, '\n')
    .split('\n');
  return (
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">' +
    `${paragraphs(lines)}</body></html>`
  );
}

/** Plain-text part: formatting markers removed, links kept readable. */
export function textForPlainPart(text) {
  return String(text || '')
    .replace(/\[([^\]\n]{1,200})\]\(((?:https?:\/\/|mailto:)[^\s()]{1,2000})\)/gi, '$1 <$2>')
    .replace(/\*\*(?=\S)([^*\n]{1,500}?)(?<=\S)\*\*/g, '$1');
}
