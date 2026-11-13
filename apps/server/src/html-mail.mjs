// Outgoing HTML (editor content, signatures) is sanitized on the server with a strict
// allowlist before it is sent or stored. A plain-text alternative is generated from it.
import sanitizeHtml from 'sanitize-html';

const MAX_HTML = 2 * 1024 * 1024;
const SAFE_STYLE = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  'text-align': [/^(left|right|center|justify)$/],
  'font-weight': [/^(bold|normal|[1-9]00)$/],
  'font-style': [/^(italic|normal)$/],
  'text-decoration': [/^(underline|line-through|none)$/],
  'font-size': [/^\d{1,2}(px|pt|em|%)$/],
  'font-family': [/^[\w\s,'"-]{1,120}$/],
  width: [/^\d{1,4}(px|%)?$/],
  height: [/^\d{1,4}(px|%)?$/],
  'max-width': [/^\d{1,4}(px|%)$/],
  margin: [/^[\d\s.pxem%-]{1,40}$/],
  padding: [/^[\d\s.pxem%-]{1,40}$/],
  'border-left': [/^[\w\s#-]{1,40}$/],
  'vertical-align': [/^(top|middle|bottom|baseline)$/]
};

export function sanitizeOutgoingHtml(html) {
  if (typeof html !== 'string') return '';
  if (html.length > MAX_HTML) throw Object.assign(new Error('Der formatierte Text ist zu groß.'), { statusCode: 413 });
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'strike',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'pre',
      'code',
      'hr',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'font',
      'sup',
      'sub'
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'title'],
      td: ['colspan', 'rowspan', 'align', 'valign'],
      th: ['colspan', 'rowspan', 'align', 'valign'],
      table: ['cellpadding', 'cellspacing', 'border', 'width'],
      font: ['color', 'face', 'size'],
      '*': ['style']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['data', 'cid', 'https'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    allowedStyles: { '*': SAFE_STYLE },
    // Only raster data images; SVG may contain active content.
    exclusiveFilter: frame =>
      frame.tag === 'img' &&
      /^data:/i.test(frame.attribs.src || '') &&
      !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(frame.attribs.src),
    transformTags: { a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener' } }) }
  });
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text =>
  text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });

/** Wendet eine Ersetzung wiederholt an, bis sich der Text nicht mehr ändert (verschachtelte Muster wie `<scr<script></script>ipt>`). */
export function replaceUntilStable(input, pattern, replacement = '') {
  let out = String(input ?? '');
  for (let i = 0; i < 20; i++) {
    const next = out.replace(pattern, replacement);
    if (next === out) break;
    out = next;
  }
  return out;
}
/** Entfernt alle Tags, auch verschachtelte Konstrukte. */
export const stripTags = input => replaceUntilStable(input, /<[^>]*>/g, '');

/** Readable plain text from (sanitized) HTML: paragraphs, lists, quotes and links survive. */
export function htmlToText(html) {
  let out = replaceUntilStable(html, /<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      const label = stripTags(text).trim();
      const target = decode(href);
      return !label || label === target || `mailto:${label}` === target ? target : `${label} \uE000${target}\uE001`;
    })
    .replace(
      /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_m, inner) =>
        `\n${htmlToText(inner)
          .split('\n')
          .map(l => `> ${l}`)
          .join('\n')}\n`
    )
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr[^>]*>/gi, '\n----\n')
    .replace(/<\/(p|div|h\d|tr|ul|ol|table|pre)>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, '\t');
  out = decode(stripTags(out))
    .replace(/\uE000/g, '<')
    .replace(/\uE001/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wraps editor HTML into a complete document with neutral, mail-client friendly styles. */
export function wrapHtmlDocument(body) {
  return (
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">' +
    `${body}</body></html>`
  );
}
