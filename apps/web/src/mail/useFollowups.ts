// Snoozed mail and due follow-ups of the mail module. Split out of MailInstance (ARC-LEV-005).
import { useEffect, useState } from 'react';
import { getJson } from '../api';

export type SnoozedEntry = { id: string; messageId: string | null; snoozeUid?: string | null; until: string };

/** The snooze entries of the account while its snooze folder is open (reloaded when the list changes). */
export function useSnoozedEntries(inSnoozeFolder: boolean, accountId: string, listSize: number) {
  const [snoozed, setSnoozed] = useState<SnoozedEntry[]>([]);
  useEffect(() => {
    if (!inSnoozeFolder) {
      setSnoozed([]);
      return;
    }
    let active = true;
    getJson<{ items: SnoozedEntry[] }>('/api/snoozed', accountId)
      .then(d => {
        if (active) setSnoozed(d.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inSnoozeFolder, accountId, listSize]);
  return snoozed;
}

/** Number of due follow-ups (all accounts), refreshed every minute; the follow-up view sets it too. */
export function useFollowupsDue() {
  const [due, setDue] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      getJson<{ items: { state: string }[] }>('/api/followups')
        .then(d => {
          if (active) setDue(d.items.filter(i => i.state === 'due').length);
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return [due, setDue] as const;
}
