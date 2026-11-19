// Inbox order of a mailbox: sender screening and the optional AI second opinion on bundles.
// Split out of MailInstance (ARC-LEV-005).
import { useEffect, useMemo, useRef, useState } from 'react';
import { getJson, postAction } from '../api';
import { useUi } from '../ConfirmDialog';
import { useT } from '../i18n';
import { applySuggestions, bundleSuggester, type BundleSuggestion } from '../bundle-suggest';
import type { ScreeningState } from '../Screening';
import type { ReaderAction } from '../Reader';
import type { Message } from '../types';

/** Bundles with the optional second opinion (AI) over the local rules. */
export function useBundleSuggestions(bundling: boolean, messages: Message[], accountId: string) {
  const [suggestions, setSuggestions] = useState<Map<number, BundleSuggestion>>(() => new Map());
  useEffect(() => setSuggestions(new Map()), [accountId]);
  useEffect(() => {
    const suggest = bundleSuggester();
    if (!bundling || !suggest || !messages.length) return;
    let active = true;
    suggest(messages, accountId)
      .then(found => {
        if (active && found.size) setSuggestions(old => new Map([...old, ...found]));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bundling, messages, accountId]);
  return useMemo(
    () => (bundling ? applySuggestions(messages, suggestions) : messages),
    [bundling, messages, suggestions]
  );
}

type ScreeningInput = {
  enabled: boolean;
  accountReady: boolean;
  accountId: string;
  /** The plain inbox is shown (no search, no other folder). */
  plainInbox: boolean;
  messages: Message[];
  writeEnabled: boolean;
  actionBusy: boolean;
  runAction: (action: ReaderAction, uids: number[]) => Promise<boolean>;
};

/** Sender screening: decisions of the account, senders still to decide, blocked mail to spam. */
export function useScreening({
  enabled,
  accountReady,
  accountId,
  plainInbox,
  messages,
  writeEnabled,
  actionBusy,
  runAction
}: ScreeningInput) {
  const { t } = useT();
  const { toast } = useUi();
  const [screening, setScreening] = useState<ScreeningState | null>(null);
  const [screener, setScreener] = useState(false);
  const [unknownSenders, setUnknownSenders] = useState<Set<string>>(() => new Set());
  const checkedSenders = useRef(new Set<string>());
  const spamMoved = useRef(new Set<number>());
  const screeningOn = enabled && plainInbox && Boolean(screening?.since);
  const blockedSenders = useMemo(() => new Set(screening?.blocked || []), [screening]);
  const screened = useMemo(
    () => (screeningOn ? messages.filter(m => unknownSenders.has(m.fromEmail.toLowerCase())) : []),
    [screeningOn, messages, unknownSenders]
  );

  // Sender screening: load (and on first use start) the decisions of this account.
  useEffect(() => {
    checkedSenders.current = new Set();
    spamMoved.current = new Set();
    setUnknownSenders(new Set());
    setScreening(null);
    if (!enabled || !accountReady) return;
    let active = true;
    getJson<ScreeningState>('/api/screening', accountId)
      .then(s => (s.since ? s : postAction<ScreeningState>('/api/screening/start', {}, accountId)))
      .then(s => active && setScreening(s))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [enabled, accountReady, accountId]);
  // Ask the server which senders of newly arrived mail are new (not in contacts, never written to).
  useEffect(() => {
    if (!screeningOn || !screening?.since) return;
    const since = Date.parse(screening.since);
    const decided = new Set([...screening.allowed, ...screening.blocked]);
    const candidates = [
      ...new Set(
        messages
          .filter(m => !m.bundle && m.date && Date.parse(m.date) >= since)
          .map(m => m.fromEmail.toLowerCase())
          .filter(e => e && !decided.has(e) && !checkedSenders.current.has(e))
      )
    ].slice(0, 300);
    if (!candidates.length) return;
    for (const e of candidates) checkedSenders.current.add(e);
    postAction<{ unknown: string[] }>('/api/screening/check', { emails: candidates }, accountId)
      .then(r => {
        if (r.unknown.length) setUnknownSenders(old => new Set([...old, ...r.unknown]));
      })
      .catch(() => {
        for (const e of candidates) checkedSenders.current.delete(e);
      });
  }, [screeningOn, screening, messages, accountId]);
  // Mail from blocked senders goes to the spam folder as soon as it shows up.
  useEffect(() => {
    if (!screeningOn || !writeEnabled || actionBusy || !blockedSenders.size) return;
    const uids = messages
      .filter(m => blockedSenders.has(m.fromEmail.toLowerCase()) && !spamMoved.current.has(m.uid))
      .map(m => m.uid);
    if (!uids.length) return;
    for (const uid of uids) spamMoved.current.add(uid);
    void runAction('spam', uids).then(ok => {
      if (!ok) for (const uid of uids) spamMoved.current.delete(uid);
    });
    // runAction comes from the mailbox and changes on every render; the effect runs again when
    // its inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screeningOn, writeEnabled, actionBusy, blockedSenders, messages]);

  const decideSender = async (email: string, decision: 'allow' | 'block', uids: number[]) => {
    try {
      const next = await postAction<ScreeningState>('/api/screening/decide', { email, decision }, accountId);
      setScreening(next);
      setUnknownSenders(old => {
        const copy = new Set(old);
        copy.delete(email);
        return copy;
      });
      if (decision === 'block') {
        for (const uid of uids) spamMoved.current.add(uid);
        await runAction('spam', uids);
      } else toast({ text: t('{email} angenommen.', { email }), kind: 'success' });
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  };

  return { screeningOn, blockedSenders, unknownSenders, screened, screener, setScreener, decideSender };
}
