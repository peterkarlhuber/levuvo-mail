// Recognises tracking pixels in HTML mails: invisible or tiny remote images and images
// from well-known open-tracking services. Such images are removed from the rendered mail
// even when the user loads external images, so the sender never learns that (or when)
// the mail was opened. Kept deliberately conservative: a false positive hides an image,
// so ordinary pictures must never match.

/** Hosts (and their subdomains) that only serve open-tracking pixels. */
const TRACKER_HOSTS = [
  'mailtrack.io',
  'mltrk.io',
  'getnotify.com',
  'mailfoogae.appspot.com',
  'sidekickopen01.com',
  'sidekickopen02.com',
  'sidekickopen03.com',
  'hubspotemail.net',
  'track.hubspot.com',
  'track.mixmax.com',
  'r.superhuman.com',
  't.yesware.com',
  'pixel.mailchimp.com'
];

/** Host + path combinations of large mailing services' open trackers. */
const TRACKER_URLS: [RegExp, RegExp][] = [
  [/(^|\.)list-manage\.com$/, /^\/track\/open/],
  [/(^|\.)mandrillapp\.com$/, /^\/track\/open/],
  [/(^|\.)sendgrid\.net$/, /^\/wf\/open/],
  [/(^|\.)exct\.net$/, /^\/open\.aspx/],
  [/(^|\.)rs6\.net$/, /^\/on\.jsp/],
  [/(^|\.)createsend\d*\.com$|(^|\.)cmail\d+\.com$/, /^\/t\//],
  [/(^|\.)mcsv\.net$/, /^\/track\/open/],
  [/(^|\.)awstrack\.me$/, /^\/I0\//]
];

/** Path patterns used by self-hosted tracking (e.g. "/track/open.php", "/pixel.gif"). */
const TRACKER_PATH =
  /\/(?:track(?:ing)?\/open|open[-_.]?track|wf\/open|email[-_]?open)(?:[/.?]|$)|\/(?:open|opened|pixel|beacon|tracking[-_]?pixel|spacer[-_]?track)\.(?:gif|png|php|aspx|jsp)$/i;

export type ImageInfo = { src: string; width?: string | null; height?: string | null; style?: string | null };

const isRemote = (src: string) => /^\s*(?:https?:)?\/\//i.test(src);

function pixels(value: string | null | undefined) {
  if (value == null) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

function styleValue(style: string, prop: string) {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return m ? m[1].replace(/!important/i, '').trim() : null;
}

/** True when an image is (very likely) an invisible tracking pixel or a known tracker. */
export function isTrackingImage({ src, width, height, style }: ImageInfo) {
  if (!isRemote(src)) return false;
  let url: URL;
  try {
    url = new URL(src.trim(), 'https://invalid.invalid');
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (TRACKER_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return true;
  if (TRACKER_URLS.some(([h, p]) => h.test(host) && p.test(url.pathname))) return true;
  if (TRACKER_PATH.test(url.pathname)) return true;
  const css = style || '';
  if (/^(none)$/i.test(styleValue(css, 'display') || '')) return true;
  if (/^(hidden)$/i.test(styleValue(css, 'visibility') || '')) return true;
  if (pixels(styleValue(css, 'opacity')) === 0) return true;
  const w = pixels(width) ?? pixels(styleValue(css, 'width'));
  const h = pixels(height) ?? pixels(styleValue(css, 'height'));
  // 1×1 (or 0×0) images; one tiny side is enough when the other one is tiny or missing.
  if (w !== null && h !== null) return w <= 3 && h <= 3;
  return (w !== null && w <= 1) || (h !== null && h <= 1);
}

/** Host name for display ("3 Tracker blockiert: mailtrack.io, …"). */
export function trackerHost(src: string) {
  try {
    return new URL(src.trim(), 'https://invalid.invalid').hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Identity of one message for "load external images": account, folder, UIDVALIDITY, UID and
 * Message-ID. A UID alone repeats across folders and accounts, so a consent given for one
 * message must not carry over to another one with the same UID.
 */
export function remoteImageKey(
  accountId: string,
  detail: { folder: string; uid: number; uidValidity?: string; messageId?: string | null } | null
) {
  return detail
    ? JSON.stringify([accountId, detail.folder, detail.uidValidity || '', detail.uid, detail.messageId || ''])
    : null;
}
