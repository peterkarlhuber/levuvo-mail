import DOMPurify from 'dompurify';

// HTML mails are rendered in an iframe with sandbox="allow-popups": no scripts, no
// same-origin access, no navigation of the app. On top of that:
//  - DOMPurify removes active content,
//  - the frame's own CSP blocks every network request except (on request) https images,
//  - links open via window.open, which the desktop app intercepts and confirms.

let hooksInstalled = false;
function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href.trim())) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
        node.setAttribute('title', href.trim().slice(0, 500));
      } else {
        node.removeAttribute('href');
      }
    }
    if (node.hasAttribute('target') && node.tagName !== 'A') node.removeAttribute('target');
  });
}

export function sanitizedEmailDocument(html: string, { allowRemoteImages = false } = {}) {
  installHooks();
  const safe = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    WHOLE_DOCUMENT: false,
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target'],
    FORBID_TAGS: [
      'script',
      'link',
      'base',
      'meta',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'iframe',
      'frame',
      'object',
      'embed',
      'video',
      'audio',
      'source',
      'picture',
      'svg',
      'math'
    ],
    FORBID_ATTR: ['srcset', 'formaction', 'ping', 'action']
  });
  const imgSrc = allowRemoteImages ? 'data: https:' : 'data:';
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<style>html,body{background:#fff;color:#181818;font:14px/1.6 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;margin:0;padding:14px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#1b4f9c}</style>' +
    // Blocked remote images would otherwise show the browser's broken-image icon.
    (allowRemoteImages ? '' : '<style>img:not([src^="data:"]){visibility:hidden}</style>') +
    `</head><body>${safe}</body></html>`
  );
}
