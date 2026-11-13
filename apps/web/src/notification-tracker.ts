// UID-only notification checkpoints. Never store message text, email addresses or passwords.
export type NotificationCursor = {
  version: 1;
  accountKey: string;
  uidValidity: string;
  lastUid: number;
  updatedAt: number;
};
export type InboxObservation = {
  uidValidity: string;
  highestUid: number;
  messages: { uid: number; unread: boolean }[];
};
export type DetectionReason =
  'baseline' | 'uidvalidity-reset' | 'uid-regression' | 'new' | 'unchanged' | 'outside-window';
export type DetectionResult = {
  reason: DetectionReason;
  newCount: number;
  newestUid: number;
  next: NotificationCursor;
};

// A stable, non-cryptographic fingerprint keeps account addresses out of the key.
export function accountMarkerKey(accountId: string, mailbox: string | null): string {
  const source = `${accountId}\u0000${(mailbox || '').trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${accountId}:${(hash >>> 0).toString(36)}`;
}

export function detectArrivals(
  accountKey: string,
  current: InboxObservation,
  saved: NotificationCursor | null,
  at: number
): DetectionResult {
  if (
    !/^\d+$/.test(current.uidValidity) ||
    !Number.isSafeInteger(current.highestUid) ||
    current.highestUid < 0 ||
    current.highestUid > 4294967295
  ) {
    throw new Error('Postfachstatus ungültig. Benachrichtigungen pausiert.');
  }
  const next: NotificationCursor = {
    version: 1,
    accountKey,
    uidValidity: current.uidValidity,
    lastUid: current.highestUid,
    updatedAt: at
  };
  if (
    !saved ||
    saved.version !== 1 ||
    saved.accountKey !== accountKey ||
    !Number.isSafeInteger(saved.lastUid) ||
    saved.lastUid < 0 ||
    saved.lastUid > 4294967295
  ) {
    return { reason: 'baseline', newCount: 0, newestUid: current.highestUid, next };
  }
  if (saved.uidValidity !== current.uidValidity) {
    return { reason: 'uidvalidity-reset', newCount: 0, newestUid: current.highestUid, next };
  }
  if (current.highestUid < saved.lastUid) {
    return { reason: 'uid-regression', newCount: 0, newestUid: current.highestUid, next };
  }
  if (current.highestUid === saved.lastUid) {
    return { reason: 'unchanged', newCount: 0, newestUid: current.highestUid, next };
  }
  // A read message that arrived since the checkpoint is still NEW.
  // A message moved out of INBOX before the poll does not trigger a phantom alert.
  const newUids = new Set(
    current.messages
      .map(item => item.uid)
      .filter(uid => Number.isSafeInteger(uid) && uid > saved.lastUid && uid <= current.highestUid)
  );
  if (newUids.size === 0) {
    return { reason: 'outside-window', newCount: 0, newestUid: current.highestUid, next };
  }
  return { reason: 'new', newCount: newUids.size, newestUid: current.highestUid, next };
}
