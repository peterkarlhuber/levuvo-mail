// Reader data: loads the selected message and marks it read after a short delay (if enabled).
// Split out of MailInstance (ARC-LEV-005).
import { useEffect, useReducer, type MutableRefObject } from 'react';
import { getJson, postAction } from '../api';
import { isMissingMessage } from '../mail-sync';
import type { Detail, Message } from '../types';
import { initialReaderState, readerReducer } from './reader-state';

/** Delay before an opened message counts as read (skimming with j/k leaves messages unread). */
export const MARK_READ_DELAY = 600;

/**
 * Reader state with the detail of the selected message. Lists across accounts (`crossAccount`:
 * all inboxes, search everywhere) load no detail; they open the message in its own folder.
 */
export function useReader(o: { accountId: string; folder: string; accountReady: boolean; crossAccount: boolean }) {
  const [state, dispatch] = useReducer(readerReducer, initialReaderState);
  const { accountId, folder, accountReady } = o;
  const detailUid = o.crossAccount ? null : state.selectedUid;
  // Never marks as read by itself; see useMarkReadOnOpen.
  useEffect(() => {
    if (!accountReady || detailUid === null) {
      dispatch({ type: 'detailCleared' });
      return;
    }
    const controller = new AbortController();
    dispatch({ type: 'detailRequested' });
    void getJson<Detail>(
      `/api/messages/${detailUid}?folder=${encodeURIComponent(folder)}`,
      accountId,
      controller.signal
    )
      .then(message => {
        if (!controller.signal.aborted) dispatch({ type: 'detailLoaded', detail: message });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) dispatch({ type: 'detailFailed', error: e.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) dispatch({ type: 'detailSettled' });
      });
    return () => controller.abort();
  }, [folder, detailUid, accountReady, state.reload, accountId]);
  return [state, dispatch] as const;
}

type MarkReadOptions = {
  detail: Detail | null;
  /** Preference, write access, not a draft folder, no other action running. */
  enabled: boolean;
  folder: string;
  accountId: string;
  messages: Message[];
  /** Time the last local change was sent (see the inbox snapshot in MailInstance). */
  localChangeAt: MutableRefObject<number>;
  onMarked: (uid: number) => void;
  /** The message is gone on the server (stale row): ask for a fresh state, no error. */
  onMissing: () => void;
};

export function useMarkReadOnOpen(o: MarkReadOptions) {
  const { detail, enabled, folder, accountId, messages } = o;
  useEffect(() => {
    if (!detail || !enabled || detail.stale) return;
    const item = messages.find(m => m.uid === detail.uid);
    if (!item?.unread) return;
    const timer = window.setTimeout(() => {
      o.localChangeAt.current = Date.now();
      postAction(`/api/messages/${detail.uid}/action`, { folder, action: 'markRead' }, accountId)
        .then(() => o.onMarked(detail.uid))
        .catch(e => {
          if (isMissingMessage(e)) o.onMissing();
          /* otherwise it stays unread */
        });
    }, MARK_READ_DELAY);
    return () => window.clearTimeout(timer);
    // The callbacks are recreated each render; the timer must only restart when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, enabled, folder, accountId, messages]);
}
