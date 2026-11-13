// Background inbox check in the Electron main process. It reads the cached inbox
// state (kept current by the IMAP IDLE watchers) and raises native notifications.
// No SMTP, no IMAP writes; never logs message text, credentials or addresses.
export function detectNewDesktopMessages(current, previous) {
  const validity = String(current?.uidValidity || '');
  const highest = Number(current?.highestUid);
  if (
    !/^\d+$/.test(validity) ||
    !Number.isSafeInteger(highest) ||
    highest < 0 ||
    highest > 4294967295 ||
    !Array.isArray(current?.messages)
  )
    throw new Error('Invalid IMAP monitor status.');
  const next = { uidValidity: validity, highestUid: highest };
  if (!previous) return { reason: 'baseline', count: 0, next };
  if (previous.uidValidity !== validity) return { reason: 'uidvalidity-reset', count: 0, next };
  if (highest < previous.highestUid) return { reason: 'uid-regression', count: 0, next };
  if (highest === previous.highestUid) return { reason: 'unchanged', count: 0, next };
  const matched = new Set(
    current.messages
      .map(m => m?.uid)
      .filter(uid => Number.isSafeInteger(uid) && uid > previous.highestUid && uid <= highest)
  );
  return { reason: matched.size ? 'new' : 'outside-window', count: matched.size, next };
}

export function createDesktopInboxMonitor({
  listAccounts,
  readInbox,
  notify,
  onStatus = () => {},
  intervalMs = 20000,
  logger = () => {}
}) {
  const cursors = new Map();
  let stopped = false;
  let busy = false;
  let interval = null;
  let lastStatus = { checkedAt: null, accounts: {}, running: false };
  async function check() {
    if (stopped || busy) return lastStatus;
    busy = true;
    const now = Date.now();
    const reports = {};
    try {
      const accounts = await listAccounts();
      if (!Array.isArray(accounts)) throw new Error('Account list invalid.');
      for (const account of accounts.filter(a => a.configured)) {
        const key = `${account.id}\u0000${String(account.mailbox || '').toLowerCase()}`;
        try {
          const inbox = await readInbox(account.id);
          const result = detectNewDesktopMessages(inbox, cursors.get(key));
          cursors.set(key, result.next); // advance before notification => never repeat on delivery error
          reports[account.id] = { reason: result.reason, newCount: result.count, healthy: true };
          if (result.count) {
            try {
              await notify({ id: account.id, label: account.label, count: result.count });
            } catch {
              logger('System notification failed; no repeated notification for the same UID.');
            }
          }
        } catch {
          reports[account.id] = { reason: 'error', newCount: 0, healthy: false };
          logger('Mailbox monitoring temporarily failed.');
          // Retain prior cursor for later recovery, but do not claim successful poll.
        }
      }
      // Purge removed accounts; newly-added/replaced ones receive a fresh baseline.
      const currentKeys = new Set(
        accounts.filter(a => a.configured).map(a => `${a.id}\u0000${String(a.mailbox || '').toLowerCase()}`)
      );
      for (const key of cursors.keys()) if (!currentKeys.has(key)) cursors.delete(key);
      lastStatus = { checkedAt: now, accounts: reports, running: true };
    } catch {
      logger('Account list for desktop notifications not available.');
      lastStatus = { checkedAt: now, accounts: reports, running: true, error: 'Account check failed' };
    } finally {
      busy = false;
      onStatus(lastStatus);
    }
    return lastStatus;
  }
  return {
    start() {
      if (!stopped && !interval) {
        void check();
        interval = setInterval(() => {
          void check();
        }, intervalMs);
      }
    },
    check,
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = null;
    },
    status() {
      return lastStatus;
    }
  };
}
