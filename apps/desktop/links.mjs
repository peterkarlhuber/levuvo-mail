// Classification of external link targets before they are handed to the OS.
// Own website, and the sign-in pages of the OAuth providers (opened by "Sign in with …").
// A sign-in page is only trusted as the app's own sign-in: the authorize endpoint with the answer
// going back to this computer (127.0.0.1/oauth/callback). Any other page on those hosts, e.g. a
// link in a mail, is confirmed like every other link.
const TRUSTED_HOSTS = new Set(['levuvo.at', 'www.levuvo.at']);
const OAUTH_AUTHORIZE = {
  'login.microsoftonline.com': /^\/[\w.-]+\/oauth2\/v2\.0\/authorize$/,
  'accounts.google.com': /^\/o\/oauth2\/v2\/auth$/
};
function isOwnSignIn(url) {
  const path = OAUTH_AUTHORIZE[url.hostname.toLowerCase()];
  if (!path || !path.test(url.pathname)) return false;
  try {
    const back = new URL(url.searchParams.get('redirect_uri') || '');
    return (
      back.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(back.hostname) &&
      back.pathname === '/oauth/callback'
    );
  } catch {
    return false;
  }
}

const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai';

/** Attachment previews: same-origin frames of the local API with inline=1. */
export function isPreviewFrameUrl(raw, appOrigin) {
  // Previews are shown from blob: URLs created by the app page itself; PDFs are rendered by
  // Chromium's built-in viewer, which runs as an internal extension inside that frame.
  if (String(raw).startsWith(`blob:${appOrigin}/`) || String(raw).startsWith(`chrome-extension://${PDF_VIEWER_ID}/`))
    return true;
  try {
    const url = new URL(String(raw));
    return (
      url.origin === appOrigin &&
      /^\/api\/messages\/\d+\/attachments\/\d+$/.test(url.pathname) &&
      url.searchParams.get('inline') === '1'
    );
  } catch {
    return false;
  }
}

/** Returns null for anything that is not http(s) or mailto. */
export function classifyExternalUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol === 'mailto:') {
    const display = decodeURIComponent(url.pathname || '').slice(0, 300);
    return { url: url.toString(), kind: 'mailto', host: '', display, trusted: false };
  }
  if (url.protocol === 'tel:') {
    const number = decodeURIComponent(url.pathname || '')
      .replace(/[^\d+]/g, '')
      .slice(0, 30);
    return number ? { url: `tel:${number}`, kind: 'tel', host: '', display: number, trusted: false } : null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) {
    // "https://bank.example@evil.example" style deception: show the real host only.
    url.username = '';
    url.password = '';
  }
  const host = url.hostname.toLowerCase();
  const display = url.toString().length > 300 ? `${url.toString().slice(0, 297)}…` : url.toString();
  return {
    url: url.toString(),
    kind: 'web',
    host,
    display,
    trusted: url.protocol === 'https:' && (TRUSTED_HOSTS.has(host) || isOwnSignIn(url))
  };
}
