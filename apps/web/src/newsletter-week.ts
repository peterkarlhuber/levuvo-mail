import type { Message } from './types';

const WEEK = 7 * 86400_000;
const MAX = 20;

/** The newsletters of the last seven days (newest first, at most 20) that the overview reads. */
export function weekOfNewsletters(messages: Message[], now = Date.now()) {
  return messages
    .filter(m => m.bundle === 'newsletter' && m.date && now - Date.parse(m.date) <= WEEK)
    .sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || ''))
    .slice(0, MAX);
}
