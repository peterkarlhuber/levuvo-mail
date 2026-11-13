export type Folder = {
  path: string;
  name: string;
  specialUse?: string | null;
  selectable?: boolean;
  unseen?: number | null;
  total?: number | null;
  delimiter?: string | null;
};

export type Address = { name: string; email: string };

export type Message = {
  uid: number;
  seq?: number;
  fromName: string;
  fromEmail: string;
  to?: Address[];
  subject: string;
  date: string | null;
  unread: boolean;
  flagged?: boolean;
  folder?: string;
  answered?: boolean;
  preview?: string;
  hasAttachments?: boolean;
  messageId?: string | null;
  inReplyTo?: string | null;
  accountId?: string;
  accountLabel?: string;
};

export type MessagePage = {
  folder: string;
  total: number;
  messages: Message[];
  hasMore: boolean;
  nextBeforeUid: number | null;
  stale?: boolean;
  cachedAt?: number;
};

export type AccountItem = { id: string; label: string; mailbox: string | null; configured: boolean };

export type PushStatus = { connected: boolean; healthy: boolean; error: string | null; at: number | null } | null;

export type ApiStatus = {
  configured: boolean;
  mailbox: string | null;
  readOnly: boolean;
  smtpConfigured: boolean;
  sendEnabled: boolean;
  sender: string | null;
  writeEnabled?: boolean;
  draftsEnabled?: boolean;
  signature?: string;
  signatureHtml?: string;
  displayName?: string;
  identities?: Identity[];
  auth?: 'password' | 'oauth2';
  push?: PushStatus;
};

export type Attachment = {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
  embedded?: boolean;
};

export type Detail = {
  uid: number;
  folder: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  bcc?: Address[];
  replyTo: Address[];
  subject: string;
  date: string | null;
  messageId?: string | null;
  draftId?: string | null;
  uidValidity?: string;
  text: string;
  html: string;
  remoteContent?: boolean;
  /** Newsletter offers List-Unsubscribe (RFC 2369 / RFC 8058). */
  unsubscribe?: {
    method: 'one-click' | 'mail' | 'web';
    host: string | null;
    mailto: string | null;
    url: string | null;
  } | null;
  attachments: Attachment[];
  textTruncated: boolean;
  htmlTruncated: boolean;
  readOnly: boolean;
  stale?: boolean;
  cachedAt?: number;
} & DetailExtras;

export type InboxMonitorResult = MessagePage & {
  uidValidity: string;
  highestUid: number;
  unseen?: number | null;
  checkedAt?: number;
  source?: 'idle' | 'poll';
  readOnly: true;
};

export type InboxSnapshot = { messages: Message[]; checkedAt: number; unseen: number | null };

export type Runtime = { desktop: boolean; version: string; platform?: string };

export type Identity = { email: string; name: string; signatureHtml?: string };

export type CryptoInfo = {
  method: 'pgp' | 'smime';
  encrypted: boolean;
  locked: boolean;
  error: string | null;
  inline?: boolean;
  signatures: {
    valid: boolean;
    trusted?: boolean;
    known?: boolean;
    signer: string | null;
    issuer?: string | null;
    matchesSender?: boolean;
    fingerprint?: string | null;
  }[];
} | null;

export type SecurityCheck = {
  level: 'ok' | 'info' | 'warning' | 'danger';
  code: string;
  [key: string]: string | number | boolean | undefined;
};
export type SecurityReport = {
  level: 'ok' | 'info' | 'warning' | 'danger';
  auth: { spf?: string; dkim?: string; dmarc?: string };
  checks: SecurityCheck[];
};

export type Attendee = { email: string; name: string; partstat: string; role?: string; rsvp?: boolean };
export type Invitation = {
  method: string;
  uid: string;
  sequence: number;
  recurrenceId: string | null;
  summary: string;
  location: string;
  description: string;
  allDay: boolean;
  start: string | null;
  end: string | null;
  recurring: boolean;
  organizer: { email: string; name: string } | null;
  attendees: Attendee[];
  myStatus: string | null;
  isOrganizer: boolean;
};

export type DetailExtras = {
  flagged?: boolean;
  unread?: boolean;
  crypto?: CryptoInfo;
  security?: SecurityReport;
  invitation?: Invitation;
  pgpKeys?: number[];
  scheduledFor?: string;
  offlineIndex?: boolean;
  /** Password-protected message (Levuvo): the hint shown before unlocking. */
  protected?: { hint: string };
};

export type CalendarInfo = {
  accountId: string;
  accountLabel?: string;
  url: string;
  name: string;
  color: string;
  hidden: boolean;
  readOnly: boolean;
  /** Microsoft 365 / Google calendars of an OAuth mail account. */
  source?: 'microsoft' | 'google' | 'local';
  primary?: boolean;
};
export type CalendarEvent = {
  uid: string;
  url: string;
  etag: string;
  accountId: string;
  calendarUrl: string;
  color: string;
  summary: string;
  location: string;
  description: string;
  status: string;
  start: string;
  end: string;
  allDay: boolean;
  tzid: string | null;
  recurring: boolean;
  recurrenceId: string | null;
  /** Microsoft 365 / Google: id of the series an occurrence belongs to. */
  seriesId?: string | null;
  source?: 'microsoft' | 'google';
  rrule: { freq: string; interval: number; count: number | null; until: string | null; byday: string[] } | null;
  organizer: { email: string; name: string } | null;
  attendees: Attendee[];
  alarms: number[];
};
export type ContactEntry = { value: string; type: string };
export type Contact = {
  uid: string;
  url?: string;
  etag?: string;
  accountId?: string;
  addressBookUrl?: string;
  name: string;
  firstName: string;
  lastName: string;
  emails: ContactEntry[];
  phones: ContactEntry[];
  organization: string;
  title: string;
  address: string;
  birthday: string;
  note: string;
};
export type AddressBook = { accountId: string; url: string; name: string; accountLabel?: string };
export type DavAccount = { id: string; label: string; serverUrl: string; username: string; hasPassword: boolean };
