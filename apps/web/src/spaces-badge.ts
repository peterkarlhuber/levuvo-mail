// Unread chat messages across all spaces, for the badge on the "Räume" rail item. Counted on
// this device only (no read receipts exist).
import { useEffect, useState } from 'react';
import { spaces } from './spaces-api';

const EVERY_MS = 20_000;

export function useSpacesChatBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const list = await spaces.list();
        if (!stopped) setCount(list.spaces.reduce((n, s) => n + (s.status === 'active' ? s.unreadChat || 0 : 0), 0));
      } catch {
        /* spaces not available (e.g. locked keychain): no badge */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  return count;
}
