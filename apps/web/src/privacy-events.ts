// Counters for the privacy cockpit: how many tracking pixels were blocked and how often external
// images were loaded. Only numbers reach the server; each message counts once per app session,
// so reopening a mail does not inflate the figures. Reports are batched.
import { postJson } from './api';

const seen = new Set<string>();
let pending = { trackers: 0, remoteImages: 0 };
let timer: ReturnType<typeof setTimeout> | null = null;
const MAX_SEEN = 5000;

function flush() {
  timer = null;
  const body = {
    trackers: Math.min(pending.trackers, 500),
    remoteImages: Math.min(pending.remoteImages, 500)
  };
  pending = { trackers: 0, remoteImages: 0 };
  if (!body.trackers && !body.remoteImages) return;
  void postJson('/api/privacy/events', body, 'mail-v1').catch(() => {});
}

function count(kind: 'trackers' | 'remoteImages', key: string, n: number) {
  const id = `${kind}|${key}`;
  if (n <= 0 || seen.has(id)) return;
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(id);
  pending[kind] += n;
  timer ??= setTimeout(flush, 5000);
}

/** Blocked tracking pixels of one message (`key` identifies the message). */
export const reportTrackers = (key: string | null, n: number) => key && count('trackers', key, n);
/** The user loaded the external images of one message. */
export const reportRemoteImages = (key: string | null) => key && count('remoteImages', key, 1);
