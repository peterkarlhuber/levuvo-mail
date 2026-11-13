// Tiny bridge between the command palette (app shell) and the mail view.

export type MailCommand =
  | { type: 'compose' }
  | { type: 'search' }
  | { type: 'followups' }
  | { type: 'shortcuts' }
  | { type: 'folder'; path: string };

export type PaletteFolder = { path: string; label: string; unseen?: number | null };

let folders: { accountId: string; list: PaletteFolder[] } = { accountId: '', list: [] };

/** The mail view reports its folders (with translated names) for the palette. */
export function publishFolders(accountId: string, list: PaletteFolder[]) {
  folders = { accountId, list };
}
export const currentFolders = () => folders;

export function sendMailCommand(command: MailCommand) {
  window.dispatchEvent(new CustomEvent<MailCommand>('levuvo:command', { detail: command }));
}

/** Lower-case, accent-free text for matching ("Entwürfe" ↔ "entwurfe"). */
export const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

/**
 * Scores how well a query matches a label: every query word must occur; a match at the start
 * of the label or of a word ranks higher. Returns -1 for "no match".
 */
export function matchScore(query: string, label: string, keywords = '') {
  const q = normalize(query).trim();
  if (!q) return 0;
  const text = normalize(`${label} ${keywords}`);
  const words = q.split(/\s+/);
  let score = 0;
  for (const w of words) {
    const at = text.indexOf(w);
    if (at < 0) return -1;
    score += at === 0 ? 30 : /\s|[:(]/.test(text[at - 1] || '') ? 15 : 5;
  }
  if (normalize(label).startsWith(q)) score += 50;
  return score - label.length / 100;
}
