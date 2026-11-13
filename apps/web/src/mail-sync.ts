// Keeps the visible message list in step with the server (unit-tested in apps/web/test).
import type { Message } from './types';

/** Newest snapshot replaces the top of the list; older pages that were loaded stay. */
export function mergeSnapshot(current: Message[], incoming: Message[]) {
  // One row per valid UID: an incomplete or repeated entry must never appear as an extra empty message.
  const seen = new Set<number>();
  const snapshot = incoming.filter(
    m => Number.isSafeInteger(m.uid) && m.uid > 0 && !seen.has(m.uid) && seen.add(m.uid)
  );
  if (!snapshot.length) return [];
  const oldestInSnapshot = Math.min(...snapshot.map(m => m.uid));
  const flags = new Map(current.map(m => [m.uid, m.flagged]));
  return [
    ...snapshot.map(m => (m.flagged === undefined && flags.has(m.uid) ? { ...m, flagged: flags.get(m.uid) } : m)),
    ...current.filter(m => m.uid < oldestInSnapshot)
  ];
}

/**
 * A snapshot may replace the list only if it is newer than the one already applied and was
 * taken after the last local change (`checkedAt` is when the server started reading the
 * mailbox; `localChangeAt` is when the change request was sent). An older snapshot can still
 * contain a message that was just deleted or moved here.
 */
export const snapshotApplies = (checkedAt: number, appliedAt: number, localChangeAt: number) =>
  checkedAt > appliedAt && checkedAt > localChangeAt;

const FLAG_ACTIONS = new Set(['markRead', 'markUnread', 'flag', 'unflag']);
/** Actions that take the message out of its folder (move, trash, archive, spam …). */
export const removesMessages = (action: string) => !FLAG_ACTIONS.has(action);

/** The server reports that none of the messages exist any more: the rows were stale. */
export const isMissingMessage = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'message_missing';
