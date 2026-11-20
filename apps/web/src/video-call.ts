// Video calls over Jitsi Meet (see apps/server/src/video-call.mjs). The server builds a link with
// a random room name; these helpers find such links in text and place them in an appointment.
// Pure functions (unit-tested in apps/web/test, no runtime imports).

export type VideoLink = { url: string; room: string; server: string; provider: 'jitsi' };
export type VideoSettings = { provider: 'jitsi'; server: string; custom: string; defaultServer: string };

/** Hosts that are always recognised as Jitsi, besides the configured server. */
const KNOWN = /^https:\/\/(?:meet\.jit\.si|meet\.ffmuc\.net|8x8\.vc)\/[A-Za-z0-9._~-]+/;

/**
 * The first video call link in a text: a link to one of `servers` (with a room name) or to a
 * known Jitsi host. '' when there is none.
 */
export function findVideoLink(text: string, servers: string[] = []): string {
  const urls = String(text || '').match(/https:\/\/[^\s<>"')\]]+/g) || [];
  for (const raw of urls) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    if (KNOWN.test(url)) return url;
    for (const server of servers) {
      if (!server) continue;
      const base = server.replace(/\/+$/, '');
      if (url.startsWith(`${base}/`) && /^[A-Za-z0-9._~-]+$/.test(url.slice(base.length + 1))) return url;
    }
  }
  return '';
}

/**
 * Puts a call link into an appointment: as the location while it is empty, otherwise as the first
 * line of the description (the location stays what the user typed, e.g. a meeting room).
 */
export function withVideoLink<T extends { location: string; description: string }>(
  draft: T,
  url: string,
  label: string
): T {
  if (!draft.location.trim()) return { ...draft, location: url };
  const line = `${label}: ${url}`;
  return { ...draft, description: draft.description.trim() ? `${line}\n\n${draft.description}` : line };
}

/** Text of a chat message or a plain-text mail that invites to a call. */
export function videoInviteText(url: string, intro: string) {
  return `${intro}\n${url}`;
}

/** Splits text into plain parts and https links, for showing links in chat messages. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /https:\/\/[^\s<>"]+/g;
  let last = 0;
  for (const m of String(text).matchAll(re)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/)?.[0] || '';
    url = url.slice(0, url.length - trail.length);
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: url, href: url });
    last = m.index! + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
