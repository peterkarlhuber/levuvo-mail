// Video calls over Jitsi Meet. Levuvo Mail only builds the link: a random, unguessable room name
// on the chosen server. The app itself opens no connection to the server; the call runs in the
// browser of whoever opens the link (the desktop app asks before it opens an outside link).
// Default is a server in the EU (Freifunk München, Germany); an own Jitsi server can be set.
import { randomBytes } from 'node:crypto';

/** Default server: operated in Germany by Freifunk München e.V., no account needed. */
export const DEFAULT_VIDEO_SERVER = 'https://meet.ffmuc.net';
export const VIDEO_PROVIDER = 'jitsi';
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 signs, no look-alikes (l, o, 0, 1)
const fail = (message, code = 'video_server_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

/**
 * The server as the settings keep it: '' for the default, or `https://host[:port][/path]`
 * without a trailing slash. Only https, no user name or password, no query or fragment.
 */
export function normalizeVideoServer(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length > 300 || /\s/.test(raw)) throw fail('Bitte eine gültige Adresse des Jitsi-Servers eingeben.');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw fail('Bitte eine gültige Adresse des Jitsi-Servers eingeben.');
  }
  if (url.protocol !== 'https:') throw fail('Der Jitsi-Server muss mit https:// erreichbar sein.');
  if (url.username || url.password || url.search || url.hash)
    throw fail('Bitte nur die Adresse des Servers angeben, ohne Zugangsdaten oder Parameter.');
  // A host name with at least one dot (or an IP address); no bare words like "localhost".
  if (!/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$|^\[[0-9a-f:]+\]$/i.test(url.hostname))
    throw fail('Bitte eine gültige Adresse des Jitsi-Servers eingeben.');
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!/^(?:\/[A-Za-z0-9._~-]+)*$/.test(pathname)) throw fail('Bitte eine gültige Adresse des Jitsi-Servers eingeben.');
  const out = `https://${url.host.toLowerCase()}${pathname}`;
  return out === DEFAULT_VIDEO_SERVER ? '' : out;
}

/** Server in effect for a settings object (`videoServer` in app-settings.json). */
export function videoServerOf(settings) {
  try {
    return normalizeVideoServer(settings?.videoServer) || DEFAULT_VIDEO_SERVER;
  } catch {
    return DEFAULT_VIDEO_SERVER;
  }
}

/**
 * Random room name like `levuvo-k7m2q-9xw4t-…`: 25 signs from 32 = 125 bits, so nobody can
 * guess the room. Jitsi rooms are open to everyone who knows the name.
 */
export function videoRoomName(random = randomBytes) {
  const bytes = random(25);
  let out = '';
  for (let i = 0; i < 25; i++) out += ALPHABET[bytes[i] & 31] + (i % 5 === 4 && i < 24 ? '-' : '');
  return `levuvo-${out}`;
}

/** A new meeting link on the server in effect. */
export function newMeetingLink(settings, random) {
  const server = videoServerOf(settings);
  const room = videoRoomName(random);
  return { url: `${server}/${room}`, room, server, provider: VIDEO_PROVIDER };
}
