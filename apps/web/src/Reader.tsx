import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Check,
  CloudOff,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Forward,
  HelpCircle,
  Image,
  KeyRound,
  LoaderCircle,
  MailX,
  Lock,
  Mail,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Printer,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Star,
  Trash2,
  Unlock,
  WifiOff,
  X
} from 'lucide-react';
import { accountPath, ApiError, download, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { sanitizedEmailDocument } from './email-document';
import { addressLabel, currentLocale, dateLabel, fullDateLabel, htmlToPlainText, initials, prettySize } from './format';
import { useT } from './i18n';
import { localizeCalendars } from './calendar-utils';
import WhenMenu from './WhenMenu';
import type {
  Attachment,
  CalendarInfo,
  Detail,
  Folder,
  Invitation,
  Message,
  SecurityCheck,
  SecurityReport
} from './types';

export type ReaderAction =
  'markRead' | 'markUnread' | 'flag' | 'unflag' | 'archive' | 'trash' | 'move' | 'spam' | 'notSpam';

type Props = {
  accountId: string;
  message: Message | null;
  detail: Detail | null;
  detailBusy: boolean;
  detailError: string;
  folders: Folder[];
  folder: string;
  writeEnabled: boolean;
  draftsEnabled: boolean;
  actionBusy: boolean;
  archiveExists: boolean;
  isTrash: boolean;
  isJunk: boolean;
  isDraftFolder: boolean;
  open: boolean;
  onClose: () => void;
  onRetry: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onEditDraft: () => void;
  onAction: (action: ReaderAction, destination?: string) => void;
  onCreateArchive: () => void;
  onSnooze: (until: Date) => void;
  snoozedUntil?: string | null;
  onWake?: () => void;
  /** After unsubscribing: move the newsletter to the trash. */
  onUnsubscribed?: () => void;
  onOpenThreadMessage: (folder: string, uid: number) => void;
};

const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/i;

function useCheckText() {
  const { t } = useT();
  return (c: SecurityCheck) => {
    switch (c.code) {
      case 'dmarc_fail':
        return t(
          'Absender nicht bestätigt: Die Domain {domain} lehnt diese Nachricht ab (DMARC). Vorsicht – möglicherweise gefälscht.',
          { domain: String(c.domain || '') }
        );
      case 'dmarc_pass':
        return t('Absender-Domain {domain} bestätigt (DMARC).', { domain: String(c.domain || '') });
      case 'spf_fail':
        return t('Der versendende Server ist für diese Domain nicht berechtigt (SPF).');
      case 'dkim_fail':
        return t('Die digitale Absendersignatur ist ungültig (DKIM).');
      case 'auth_unknown':
        return t('Der Mailserver hat keine Absenderprüfung (SPF/DKIM/DMARC) vermerkt.');
      case 'display_name_spoof':
        return t('Der angezeigte Name enthält die Adresse {shown}, gesendet wurde aber von {actual}.', {
          shown: String(c.shown),
          actual: String(c.actual)
        });
      case 'reply_to_differs':
        return t('Antworten gehen an eine andere Domain: {replyTo}', { replyTo: String(c.replyTo) });
      case 'punycode_domain':
        return t('Die Absender-Domain {domain} verwendet ungewöhnliche Schriftzeichen (Punycode).', {
          domain: String(c.domain)
        });
      case 'deceptive_link':
        return t('Irreführender Link: Angezeigt wird „{shown}“, das Ziel ist aber {actual}.', {
          shown: String(c.shown),
          actual: String(c.actual)
        });
      case 'dangerous_attachment':
        return t('Gefährlicher Dateityp im Anhang: {filename}. Nicht öffnen, wenn du ihn nicht erwartest.', {
          filename: String(c.filename)
        });
      case 'macro_attachment':
        return t('Anhang mit möglichen Makros: {filename}. Makros nur bei vertrauenswürdigen Absendern aktivieren.', {
          filename: String(c.filename)
        });
      case 'archive_attachment':
        return t('Archiv im Anhang: {filename}. Inhalt vor dem Öffnen prüfen.', { filename: String(c.filename) });
      case 'first_contact':
        return t('Du hast mit diesem Absender bisher keinen Kontakt gehabt.');
      default:
        return c.code;
    }
  };
}

function SecurityBanner({ report }: { report: SecurityReport }) {
  const { t } = useT();
  const text = useCheckText();
  const [open, setOpen] = useState(false);
  const serious = report.checks.filter(c => c.level === 'danger' || c.level === 'warning');
  if (!serious.length) {
    const ok = report.checks.find(c => c.code === 'dmarc_pass');
    return (
      <div className="reader-security subtle">
        {ok ? <ShieldCheck size={14} /> : <ShieldQuestion size={14} />}
        <span>{ok ? text(ok) : t('Keine Auffälligkeiten erkannt.')}</span>
        {report.checks.length > 0 && (
          <button className="text-button" onClick={() => setOpen(!open)}>
            {open ? t('Weniger') : t('Details')}
          </button>
        )}
        {open && (
          <ul className="security-details">
            {report.checks.map((c, i) => (
              <li key={i}>{text(c)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const danger = report.level === 'danger';
  return (
    <div className={`security-banner ${danger ? 'danger' : 'warning'}`} role="alert">
      {danger ? <ShieldX size={18} /> : <ShieldAlert size={18} />}
      <div>
        <strong>{danger ? t('Vorsicht: mögliche Phishing-Nachricht') : t('Bitte genau prüfen')}</strong>
        <ul>
          {serious.map((c, i) => (
            <li key={i}>{text(c)}</li>
          ))}
        </ul>
        <small>
          {t(
            'Keine Zugangsdaten eingeben und keine Zahlungen veranlassen, ohne den Absender auf anderem Weg zu bestätigen.'
          )}
        </small>
      </div>
    </div>
  );
}

function CryptoBadges({ detail, onReload }: { detail: Detail; onReload: () => void }) {
  const { t } = useT();
  const { prompt, toast } = useUi();
  const c = detail.crypto;
  if (!c) return null;
  const method = c.method === 'pgp' ? 'OpenPGP' : 'S/MIME';
  async function unlock() {
    const info = await getJson<{ pgp: { own: { fingerprint: string; hasSecret: boolean; unlocked: boolean }[] } }>(
      '/api/crypto'
    );
    const keys = c?.method === 'pgp' ? info.pgp.own.filter(k => k.hasSecret && !k.unlocked) : [];
    if (c?.method === 'pgp' && !keys.length) {
      toast({ text: t('Kein passender privater Schlüssel vorhanden.'), kind: 'error' });
      return;
    }
    const pass = await prompt({
      title: t('Schlüssel entsperren'),
      message: t('Passphrase deines OpenPGP-Schlüssels. Er bleibt 30 Minuten entsperrt.'),
      label: t('Passphrase'),
      type: 'password',
      confirmLabel: t('Entsperren')
    });
    if (pass === null) return;
    for (const k of keys) {
      try {
        await postJson('/api/crypto/pgp/unlock', { fingerprint: k.fingerprint, passphrase: pass }, 'crypto-v1');
        onReload();
        return;
      } catch {
        /* try next */
      }
    }
    toast({ text: t('Passphrase falsch.'), kind: 'error' });
  }
  return (
    <div className="crypto-badges">
      {c.encrypted && (
        <span className={`crypto-badge ${c.locked || c.error ? 'warn' : 'ok'}`}>
          <Lock size={13} /> {t('{method} verschlüsselt', { method })}
        </span>
      )}
      {c.signatures.map((s, i) => (
        <span
          key={i}
          className={`crypto-badge ${s.valid && s.trusted !== false && s.matchesSender !== false ? 'ok' : s.valid ? 'warn' : 'bad'}`}
          title={[s.signer, s.issuer, s.fingerprint].filter(Boolean).join(' · ')}
        >
          {s.valid ? <ShieldCheck size={13} /> : <ShieldX size={13} />}
          {!s.valid
            ? t('Signatur ungültig')
            : s.known === false
              ? t('Signiert – Schlüssel unbekannt')
              : s.trusted === false
                ? t('Signiert – Zertifikat nicht vertrauenswürdig')
                : s.matchesSender === false
                  ? t('Signiert von {signer} (nicht der Absender)', { signer: s.signer || '?' })
                  : t('Signiert von {signer}', { signer: s.signer || '?' })}
        </span>
      ))}
      {c.locked && (
        <button className="btn small" onClick={() => void unlock()}>
          <Unlock size={13} /> {t('Entschlüsseln')}
        </button>
      )}
      {c.error && !c.locked && (
        <span className="crypto-badge bad">
          <AlertTriangle size={13} /> {c.error}
        </span>
      )}
    </div>
  );
}

function InvitationCard({ accountId, detail }: { accountId: string; detail: Detail }) {
  const { t, locale } = useT();
  const { toast } = useUi();
  const inv = detail.invitation as Invitation;
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(
    inv.myStatus && inv.myStatus !== 'NEEDS-ACTION' ? inv.myStatus : null
  );
  useEffect(() => {
    if (inv.method !== 'REQUEST' || inv.isOrganizer) return;
    getJson<{ calendars: CalendarInfo[] }>('/api/invitations/calendars')
      .then(d => {
        setCalendars(localizeCalendars(d.calendars, t));
        // Microsoft 365 / Google: the mailbox's own calendar answers directly at the provider.
        const own = d.calendars.filter(c => c.accountId === accountId);
        const pick = own.find(c => c.primary) || own[0] || d.calendars[0];
        setTarget(pick ? `${pick.accountId}|${pick.url}` : '');
      })
      .catch(() => setCalendars([]));
  }, [inv.method, inv.isOrganizer, accountId, t]);
  const when = (() => {
    if (!inv.start) return '';
    if (inv.allDay) {
      const s = new Date(`${inv.start}T12:00:00`);
      return new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(s);
    }
    const s = new Date(inv.start);
    const e = inv.end ? new Date(inv.end) : null;
    const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(s);
    return e ? `${day} – ${new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(e)}` : day;
  })();
  async function respond(response: 'accept' | 'tentative' | 'decline') {
    setBusy(true);
    try {
      const [calAccount, ...rest] = target.split('|');
      const calendar = target ? { accountId: calAccount, url: rest.join('|') } : null;
      const r = await postJson<{ partstat: string; stored: boolean; replied: boolean }>(
        `/api/invitations/respond?account=${encodeURIComponent(accountId)}`,
        { folder: detail.folder, uid: detail.uid, response, calendar },
        'calendar-v1'
      );
      setAnswer(r.partstat);
      toast({
        text: `${r.replied ? t('Antwort an den Organisator gesendet.') : t('Antwort gespeichert.')}${r.stored ? ` ${t('Im Kalender eingetragen.')}` : ''}`,
        kind: 'success'
      });
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await postJson<{ applied: boolean; reason?: string }>(
        `/api/invitations/apply?account=${encodeURIComponent(accountId)}`,
        { folder: detail.folder, uid: detail.uid },
        'calendar-v1'
      );
      toast({
        text: r.applied ? t('Kalender aktualisiert.') : t('Der Termin ist in keinem verbundenen Kalender.'),
        kind: r.applied ? 'success' : 'info'
      });
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  const label: Record<string, string> = {
    ACCEPTED: t('Zugesagt'),
    TENTATIVE: t('Vorläufig zugesagt'),
    DECLINED: t('Abgesagt')
  };
  const replyFrom = inv.method === 'REPLY' ? inv.attendees.find(a => a.partstat !== 'NEEDS-ACTION') : null;
  return (
    <div className={`invitation-card ${inv.method === 'CANCEL' ? 'cancelled' : ''}`}>
      <div className="invitation-icon">
        {inv.method === 'CANCEL' ? (
          <CalendarX size={22} />
        ) : inv.method === 'REPLY' ? (
          <CalendarCheck size={22} />
        ) : (
          <CalendarClock size={22} />
        )}
      </div>
      <div className="invitation-body">
        <small>
          {inv.method === 'CANCEL'
            ? t('Termin abgesagt')
            : inv.method === 'REPLY'
              ? t('Antwort auf deine Einladung')
              : t('Einladung')}
          {inv.recurring ? ` · ${t('Serie')}` : ''}
        </small>
        <strong>{inv.summary || t('(Ohne Titel)')}</strong>
        <span>{when}</span>
        {inv.location && <span>{inv.location}</span>}
        {inv.organizer && (
          <span className="muted">
            {t('Organisator')}: {inv.organizer.name || inv.organizer.email}
          </span>
        )}
        {inv.attendees.length > 0 && (
          <details>
            <summary>{t('{count} Teilnehmende', { count: inv.attendees.length })}</summary>
            <ul className="attendee-list">
              {inv.attendees.map(a => (
                <li key={a.email}>
                  <span className={`partstat ${a.partstat.toLowerCase()}`} />
                  {a.name || a.email}
                  <small>{label[a.partstat] || t('Offen')}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
        {inv.method === 'REQUEST' && !inv.isOrganizer && (
          <div className="invitation-actions">
            {calendars && calendars.length > 0 && (
              <select value={target} onChange={e => setTarget(e.target.value)} aria-label={t('Kalender')}>
                {calendars.map(c => (
                  <option key={`${c.accountId}|${c.url}`} value={`${c.accountId}|${c.url}`}>
                    {c.name}
                    {c.accountLabel ? ` · ${c.accountLabel}` : ''}
                  </option>
                ))}
              </select>
            )}
            {calendars && !calendars.length && (
              <small className="muted">
                {t('Kein Kalender verbunden – die Antwort wird nur per E-Mail gesendet.')}
              </small>
            )}
            <div className="segmented">
              <button
                disabled={busy}
                className={answer === 'ACCEPTED' ? 'active' : ''}
                onClick={() => void respond('accept')}
              >
                <Check size={14} /> {t('Zusagen')}
              </button>
              <button
                disabled={busy}
                className={answer === 'TENTATIVE' ? 'active' : ''}
                onClick={() => void respond('tentative')}
              >
                <HelpCircle size={14} /> {t('Vielleicht')}
              </button>
              <button
                disabled={busy}
                className={answer === 'DECLINED' ? 'active' : ''}
                onClick={() => void respond('decline')}
              >
                <X size={14} /> {t('Absagen')}
              </button>
            </div>
          </div>
        )}
        {inv.method === 'REPLY' && (
          <div className="invitation-actions">
            {replyFrom && (
              <span>
                {replyFrom.name || replyFrom.email}: <strong>{label[replyFrom.partstat] || replyFrom.partstat}</strong>
              </span>
            )}
            <button className="btn small" disabled={busy} onClick={() => void apply()}>
              {t('Im Kalender übernehmen')}
            </button>
          </div>
        )}
        {inv.method === 'CANCEL' && (
          <div className="invitation-actions">
            <button className="btn small" disabled={busy} onClick={() => void apply()}>
              {t('Aus dem Kalender entfernen')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentPreview({ url, att, onClose }: { url: string; att: Attachment; onClose: () => void }) {
  const { t } = useT();
  const type = att.mimeType.toLowerCase();
  // PDFs and text are loaded here (with the session cookie) and shown from a blob: URL, so the
  // built-in PDF viewer never has to fetch the document itself.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (type.startsWith('image/')) return;
    let revoked = false;
    let objectUrl = '';
    fetch(url, { cache: 'no-store' })
      .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(b => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(
          new Blob([b], { type: type === 'application/pdf' ? 'application/pdf' : 'text/plain;charset=utf-8' })
        );
        setBlobUrl(objectUrl);
      })
      .catch(() => setFailed(t('Für diesen Dateityp gibt es keine Vorschau.')));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, type, t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-scrim preview-scrim"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('Vorschau: {name}', { name: att.filename })}
      >
        <header>
          <FileText size={16} />
          <strong>{att.filename}</strong>
          <small>{prettySize(att.size)}</small>
          <button className="btn small" onClick={() => download(url.replace('&inline=1', ''))}>
            <Download size={14} /> {t('Herunterladen')}
          </button>
          <button className="icon-button" aria-label={t('Schließen')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="preview-body">
          {type.startsWith('image/') ? (
            <img src={url} alt={att.filename} />
          ) : failed ? (
            <p className="muted">{failed}</p>
          ) : blobUrl ? (
            <iframe title={att.filename} src={blobUrl} sandbox={type === 'application/pdf' ? undefined : ''} />
          ) : (
            <LoaderCircle className="spin" size={18} />
          )}
        </div>
      </div>
    </div>
  );
}

type ThreadItem = Message & { folder: string; sent?: boolean };

/** Whole conversation across Inbox, Sent, Archive and the current folder (linked by Message-ID). */
type OpenedProtected = {
  subject: string;
  from: string;
  date: string | null;
  html: string;
  text: string;
  attachments: { name: string; type: string; size: number; data: string }[];
};

/** Password-protected message: unlock right here (also in "Sent" for your own copy). */
function ProtectedCard({ accountId, detail }: { accountId: string; detail: Detail }) {
  const { t } = useT();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<OpenedProtected | null>(null);
  // Download links for the decrypted attachments (released when locked again or closed).
  const links = useMemo(
    () =>
      (opened?.attachments || []).map(a =>
        URL.createObjectURL(
          new Blob([Uint8Array.from(atob(a.data), c => c.charCodeAt(0))], { type: 'application/octet-stream' })
        )
      ),
    [opened]
  );
  useEffect(() => () => links.forEach(u => URL.revokeObjectURL(u)), [links]);
  const doc = useMemo(() => (opened?.html ? sanitizedEmailDocument(opened.html) : ''), [opened]);
  async function open(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      setOpened(
        await postJson<OpenedProtected>(
          '/api/messages/protected/open',
          { folder: detail.folder, uid: detail.uid, password },
          'mail-v1',
          accountId
        )
      );
      setPassword('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (opened)
    return (
      <section className="protected-card open" aria-label={t('Geschützte Nachricht')}>
        <header>
          <Unlock size={15} /> <strong>{t('Geschützte Nachricht – entschlüsselt')}</strong>
          <button className="text-button" onClick={() => setOpened(null)}>
            {t('Wieder sperren')}
          </button>
        </header>
        {opened.subject && <h3>{opened.subject}</h3>}
        <small className="muted">{opened.from}</small>
        {opened.html ? (
          <iframe
            className="html-mail-frame protected-frame"
            title={t('Geschützter Inhalt')}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={doc}
          />
        ) : (
          <div className="plain-mail-text">{opened.text}</div>
        )}
        {opened.attachments.length > 0 && (
          <ul className="protected-files">
            {opened.attachments.map((a, i) => (
              <li key={`${i}-${a.name}`}>
                <Paperclip size={13} />{' '}
                <a href={links[i]} download={a.name}>
                  {a.name}
                </a>{' '}
                <small className="muted">{Math.max(1, Math.round(a.size / 1024))} KB</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  return (
    <section className="protected-card" aria-label={t('Geschützte Nachricht')}>
      <header>
        <Lock size={15} /> <strong>{t('Mit Passwort geschützte Nachricht')}</strong>
      </header>
      <p>
        {t(
          'Gib das Passwort ein, das du auf einem anderen Weg erhalten hast. Die Entschlüsselung passiert nur auf diesem Gerät.'
        )}
      </p>
      {detail.protected?.hint && (
        <p className="protected-hint">
          {t('Hinweis zum Passwort:')} <i>{detail.protected.hint}</i>
        </p>
      )}
      <form onSubmit={e => void open(e)} className="protected-form">
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder={t('Passwort')}
          aria-label={t('Passwort')}
          autoComplete="off"
          required
        />
        <button className="btn primary small" disabled={busy || !password}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <Unlock size={13} />} {t('Öffnen')}
        </button>
      </form>
      {error && <p className="modal-error">{error}</p>}
    </section>
  );
}

/** Newsletter: unsubscribe in one click (RFC 8058), by e-mail or on the sender's page. */
function UnsubscribeBar({ accountId, detail, onTrash }: { accountId: string; detail: Detail; onTrash?: () => void }) {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const u = detail.unsubscribe!;
  const sender = detail.from[0]?.name || detail.from[0]?.email || u.host || '';
  async function run() {
    const how =
      u.method === 'one-click'
        ? t('Levuvo Mail meldet dich direkt beim Absender ab ({host}).', { host: u.host || '' })
        : u.method === 'mail'
          ? t('Levuvo Mail sendet eine Abmelde-E-Mail an {to}.', { to: u.mailto || '' })
          : t('Die Abmeldeseite des Absenders wird im Browser geöffnet ({host}).', { host: u.host || '' });
    const ok = await confirm({
      title: t('Von „{sender}“ abmelden?', { sender }),
      message: how,
      confirmLabel: u.method === 'web' ? t('Seite öffnen') : t('Abmelden')
    });
    if (!ok) return;
    if (u.method === 'web' && u.url) {
      window.open(u.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setState('busy');
    try {
      await postJson('/api/messages/unsubscribe', { folder: detail.folder, uid: detail.uid }, 'mail-v1', accountId);
      setState('done');
      toast({
        text: t('Abgemeldet. Es kann einige Tage dauern, bis keine Post mehr kommt.'),
        kind: 'success',
        ...(onTrash ? { action: { label: t('Nachricht löschen'), run: onTrash } } : {})
      });
    } catch (e) {
      setState('idle');
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  return (
    <div className="unsubscribe-bar">
      <MailX size={15} aria-hidden="true" />
      <span>
        {state === 'done'
          ? t('Du hast dich von diesem Newsletter abgemeldet.')
          : t('Newsletter oder Werbung von {sender}', { sender })}
      </span>
      {state !== 'done' && (
        <button className="btn small" disabled={state === 'busy'} onClick={() => void run()}>
          {state === 'busy' ? <LoaderCircle size={13} className="spin" /> : null} {t('Abmelden')}
        </button>
      )}
    </div>
  );
}

function ThreadPanel({
  accountId,
  detail,
  onOpen
}: {
  accountId: string;
  detail: Detail;
  onOpen: (folder: string, uid: number) => void;
}) {
  const { t } = useT();
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    setItems([]);
    setOpen(null);
    getJson<{ messages: ThreadItem[] }>(
      `/api/thread?folder=${encodeURIComponent(detail.folder)}&uid=${detail.uid}`,
      accountId
    )
      .then(d => {
        if (active) setItems(d.messages);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accountId, detail.folder, detail.uid]);
  if (items.length < 2) return null;
  const keyOf = (m: ThreadItem) => `${m.folder}|${m.uid}`;
  async function toggle(m: ThreadItem) {
    const key = keyOf(m);
    if (open === key) {
      setOpen(null);
      return;
    }
    setOpen(key);
    if (bodies[key] !== undefined) return;
    try {
      const d = await getJson<Detail>(`/api/messages/${m.uid}?folder=${encodeURIComponent(m.folder)}`, accountId);
      setBodies(b => ({ ...b, [key]: (d.text || htmlToPlainText(d.html)).slice(0, 20_000) }));
    } catch (e) {
      setBodies(b => ({ ...b, [key]: (e as Error).message }));
    }
  }
  return (
    <section className="thread-panel" aria-label={t('Konversation')}>
      <header>
        <MessagesSquare size={14} /> {t('Konversation')} · {items.length}
      </header>
      <ol>
        {items.map(m => {
          const key = keyOf(m);
          const current = m.folder === detail.folder && m.uid === detail.uid;
          return (
            <li key={key} className={`${current ? 'current' : ''} ${m.sent ? 'sent' : ''}`}>
              <button
                className="thread-row"
                onClick={() => (current ? undefined : void toggle(m))}
                aria-expanded={current ? undefined : open === key}
                disabled={current}
              >
                <span className="thread-avatar" aria-hidden="true">
                  {initials(m.sent ? t('Ich') : m.fromName)}
                </span>
                <span className="thread-main">
                  <strong>
                    {m.sent ? t('Ich') : m.fromName}
                    {current ? ` · ${t('diese Nachricht')}` : ''}
                  </strong>
                  <span className="thread-preview">{m.preview || m.subject}</span>
                </span>
                <time>{dateLabel(m.date)}</time>
              </button>
              {open === key && (
                <div className="thread-body">
                  {bodies[key] === undefined ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <div className="plain-mail-text">{bodies[key]}</div>
                  )}
                  <button className="text-button" onClick={() => onOpen(m.folder, m.uid)}>
                    {t('Ganze Nachricht öffnen')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function printMessage(
  detail: Detail,
  labels: { from: string; to: string; cc: string; date: string; attachments: string }
) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const body = detail.html
    ? sanitizedEmailDocument(detail.html)
        .replace(/^[\s\S]*?<body>/, '')
        .replace(/<\/body>[\s\S]*$/, '')
    : `<pre>${esc(detail.text || '')}</pre>`;
  const att = detail.attachments.filter(a => !a.embedded);
  const head = `<h1>${esc(detail.subject)}</h1><table class="meta">
    <tr><th>${labels.from}</th><td>${esc(addressLabel(detail.from))}</td></tr>
    <tr><th>${labels.to}</th><td>${esc(addressLabel(detail.to))}</td></tr>
    ${detail.cc.length ? `<tr><th>${labels.cc}</th><td>${esc(addressLabel(detail.cc))}</td></tr>` : ''}
    <tr><th>${labels.date}</th><td>${esc(fullDateLabel(detail.date))}</td></tr>
    ${att.length ? `<tr><th>${labels.attachments}</th><td>${esc(att.map(a => a.filename).join(', '))}</td></tr>` : ''}
  </table><hr>`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${esc(detail.subject)}</title>
    <style>body{font:12pt/1.5 Arial,Helvetica,sans-serif;color:#000;margin:0}h1{font-size:16pt;margin:0 0 10px}table.meta{border-collapse:collapse;font-size:10pt;margin-bottom:6px}table.meta th{text-align:left;padding:1px 12px 1px 0;color:#555;font-weight:600;vertical-align:top}pre{white-space:pre-wrap;font:11pt/1.5 Arial,Helvetica,sans-serif}img{max-width:100%}@page{margin:18mm}</style></head><body>${head}${body}</body></html>`;
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.srcdoc = doc;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1000);
    }
  };
  document.body.appendChild(frame);
}

export default function Reader(props: Props) {
  const {
    accountId,
    message,
    detail,
    detailBusy,
    detailError,
    folders,
    folder,
    writeEnabled,
    actionBusy,
    archiveExists,
    isTrash,
    isJunk,
    isDraftFolder
  } = props;
  const { t } = useT();
  const { toast, confirm } = useUi();
  const [showTextFor, setShowTextFor] = useState<number | null>(null);
  const [remoteFor, setRemoteFor] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [menu, setMenu] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  // HTML is shown by default (sandboxed frame, remote images blocked); text on request.
  const showHtml = Boolean(detail?.html) && (!detail?.text || showTextFor !== detail?.uid);
  const allowRemote = remoteFor === detail?.uid;
  const htmlDocument = useMemo(
    () => (detail?.html ? sanitizedEmailDocument(detail.html, { allowRemoteImages: allowRemote }) : ''),
    [detail?.html, allowRemote]
  );
  // The calendar part of an invitation is shown as the invitation card, not as a file.
  const visibleAttachments =
    detail?.attachments.filter(
      a => !a.embedded && !(detail.invitation && /^(text\/calendar|application\/ics)$/i.test(a.mimeType))
    ) || [];
  const flagged = detail?.flagged ?? message?.flagged ?? false;
  const unread = message?.unread ?? false;
  const header = detail
    ? {
        subject: detail.subject,
        fromName: detail.from[0]?.name || detail.from[0]?.email || message?.fromName || t('Unbekannt'),
        fromEmail: detail.from[0]?.email || message?.fromEmail || '',
        date: detail.date || message?.date || null
      }
    : message
      ? { subject: message.subject, fromName: message.fromName, fromEmail: message.fromEmail, date: message.date }
      : null;
  const attUrl = (att: Attachment, inline = false) =>
    accountPath(
      `/api/messages/${detail!.uid}/attachments/${att.index}?folder=${encodeURIComponent(detail!.folder)}${inline ? '&inline=1' : ''}`,
      accountId
    );
  const dangerous =
    detail?.security?.checks.filter(c => c.code === 'dangerous_attachment').map(c => String(c.filename)) || [];

  useEffect(() => {
    setMenu(false);
    setSnoozeMenu(false);
    setPreview(null);
  }, [detail?.uid]);
  const systemName = (f: Folder) =>
    f.path.toUpperCase() === 'INBOX'
      ? t('Posteingang')
      : (
          {
            '\\Sent': t('Gesendet'),
            '\\Drafts': t('Entwürfe'),
            '\\Trash': t('Papierkorb'),
            '\\Junk': t('Spam'),
            '\\Archive': t('Archiv')
          } as Record<string, string>
        )[f.specialUse || ''] || '';

  async function importKey(index: number) {
    if (!detail) return;
    if (
      !(await confirm({
        title: t('Öffentlichen Schlüssel importieren?'),
        message: t(
          'Nur importieren, wenn du sicher bist, dass der Schlüssel wirklich vom Absender stammt (z. B. Fingerabdruck telefonisch abgleichen).'
        ),
        confirmLabel: t('Importieren')
      }))
    )
      return;
    try {
      const r = await postJson<{ fingerprint: string; emails: string[] }>(
        '/api/crypto/pgp/import-from-message',
        { account: accountId, folder: detail.folder, uid: detail.uid, index },
        'crypto-v1'
      );
      toast({ text: t('Schlüssel für {emails} importiert.', { emails: r.emails.join(', ') }), kind: 'success' });
    } catch (err) {
      toast({ text: err instanceof ApiError ? err.message : t('Import fehlgeschlagen.'), kind: 'error' });
    }
  }
  async function downloadAttachment(att: Attachment) {
    if (
      dangerous.includes(att.filename) &&
      !(await confirm({
        title: t('Potenziell gefährliche Datei'),
        message: t(
          '„{name}“ kann Programme ausführen. Nur herunterladen, wenn du die Datei erwartest und dem Absender vertraust.',
          { name: att.filename }
        ),
        confirmLabel: t('Trotzdem herunterladen'),
        danger: true
      }))
    )
      return;
    download(attUrl(att));
  }

  return (
    <section className={`reader-column ${props.open ? 'reader-open' : ''}`} aria-label={t('Nachricht')}>
      {header ? (
        <div className="reader-content">
          <div className="reader-toolbar">
            <button className="reader-back icon-button" aria-label={t('Zurück zur Liste')} onClick={props.onClose}>
              <ArrowLeft size={19} />
            </button>
            <div className="reader-primary-actions">
              {isDraftFolder && detail?.draftId && (
                <button
                  disabled={!props.draftsEnabled || !detail.uidValidity || detailBusy}
                  onClick={props.onEditDraft}
                >
                  <FilePenLine size={15} /> {t('Bearbeiten')}
                </button>
              )}
              <button disabled={!detail || detailBusy} onClick={props.onReply} title={t('Antworten (R)')}>
                <Reply size={15} /> <span className="label">{t('Antworten')}</span>
              </button>
              <button disabled={!detail || detailBusy} onClick={props.onReplyAll} title={t('Allen antworten (A)')}>
                <ReplyAll size={15} /> <span className="label">{t('Allen')}</span>
              </button>
              <button disabled={!detail || detailBusy} onClick={props.onForward} title={t('Weiterleiten (F)')}>
                <Forward size={15} /> <span className="label">{t('Weiterleiten')}</span>
              </button>
            </div>
            <div className="reader-secondary-actions">
              <button
                disabled={!writeEnabled || !message || actionBusy}
                className={flagged ? 'is-on' : ''}
                onClick={() => props.onAction(flagged ? 'unflag' : 'flag')}
                title={flagged ? t('Markierung entfernen (S)') : t('Markieren (S)')}
                aria-label={flagged ? t('Markierung entfernen') : t('Markieren')}
                aria-pressed={flagged}
              >
                <Star size={16} fill={flagged ? 'currentColor' : 'none'} />
              </button>
              <div className="menu-anchor">
                <button
                  data-snooze
                  disabled={!writeEnabled || !message || actionBusy || isDraftFolder}
                  onClick={() => setSnoozeMenu(!snoozeMenu)}
                  title={t('Zurückstellen (B)')}
                  aria-label={t('Zurückstellen')}
                  aria-expanded={snoozeMenu}
                >
                  <AlarmClock size={16} />
                </button>
                {snoozeMenu && (
                  <WhenMenu
                    title={t('Zurückstellen bis')}
                    note={t('Die Nachricht kommt dann ungelesen in den Posteingang zurück.')}
                    onClose={() => setSnoozeMenu(false)}
                    onPick={date => {
                      setSnoozeMenu(false);
                      props.onSnooze(date);
                    }}
                  />
                )}
              </div>
              <button
                disabled={!writeEnabled || !message || actionBusy}
                onClick={() => props.onAction(unread ? 'markRead' : 'markUnread')}
                title={unread ? t('Als gelesen markieren (U)') : t('Als ungelesen markieren (U)')}
                aria-label={unread ? t('Als gelesen markieren') : t('Als ungelesen markieren')}
              >
                <Mail size={16} />
              </button>
              {archiveExists ? (
                <button
                  disabled={!writeEnabled || !message || actionBusy}
                  onClick={() => props.onAction('archive')}
                  title={t('Archivieren (E)')}
                  aria-label={t('Archivieren')}
                >
                  <Archive size={16} />
                </button>
              ) : (
                <button
                  disabled={!writeEnabled || actionBusy}
                  onClick={props.onCreateArchive}
                  title={t('Archivordner anlegen')}
                  aria-label={t('Archivordner anlegen')}
                >
                  <Archive size={16} />
                </button>
              )}
              <button
                disabled={!writeEnabled || !message || actionBusy}
                onClick={() => props.onAction(isJunk ? 'notSpam' : 'spam')}
                title={isJunk ? t('Kein Spam') : t('Als Spam markieren')}
                aria-label={isJunk ? t('Kein Spam') : t('Als Spam markieren')}
              >
                <ShieldAlert size={16} />
              </button>
              <button
                disabled={!writeEnabled || !message || actionBusy || isTrash}
                onClick={() => props.onAction('trash')}
                title={t('In den Papierkorb (Entf)')}
                aria-label={t('In den Papierkorb')}
              >
                <Trash2 size={16} />
              </button>
              <select
                aria-label={t('Verschieben nach')}
                value={moveTarget}
                disabled={!writeEnabled || actionBusy || !message}
                onChange={e => {
                  const v = e.target.value;
                  setMoveTarget('');
                  if (v) props.onAction('move', v);
                }}
              >
                <option value="">{t('Verschieben …')}</option>
                {folders
                  .filter(f => f.path !== folder)
                  .map(f => (
                    <option key={f.path} value={f.path}>
                      {systemName(f) ||
                        (f.path.split(f.delimiter || '/').length > 1
                          ? f.path.replaceAll(f.delimiter || '/', ' › ')
                          : f.name)}
                    </option>
                  ))}
              </select>
              <div className="menu-anchor">
                <button
                  aria-label={t('Weitere Aktionen')}
                  aria-expanded={menu}
                  disabled={!detail}
                  onClick={() => setMenu(!menu)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {menu && detail && (
                  <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        printMessage(detail, {
                          from: t('Von'),
                          to: t('An'),
                          cc: 'CC',
                          date: t('Datum'),
                          attachments: t('Anhänge')
                        });
                      }}
                    >
                      <Printer size={14} /> {t('Drucken / als PDF')}
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenu(false);
                        download(
                          accountPath(
                            `/api/messages/${detail.uid}/raw?folder=${encodeURIComponent(detail.folder)}`,
                            accountId
                          )
                        );
                      }}
                    >
                      <Download size={14} /> {t('Als .eml speichern')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <h2>{header.subject}</h2>
          <div className="reader-meta">
            <div className="reader-avatar" aria-hidden="true">
              {initials(header.fromName)}
            </div>
            <div className="reader-sender">
              <div className="sender-name">{header.fromName}</div>
              <div className="sender-email">{header.fromEmail}</div>
            </div>
            <time className="reader-date" title={fullDateLabel(header.date)}>
              {fullDateLabel(header.date)}
            </time>
          </div>
          {detail && (detail.to.length > 0 || detail.cc.length > 0 || detail.replyTo.length > 0) && (
            <div className="recipient-panel">
              {detail.to.length > 0 && (
                <div>
                  <strong>{t('An')}</strong>
                  <span>{addressLabel(detail.to)}</span>
                </div>
              )}
              {detail.cc.length > 0 && (
                <div>
                  <strong>CC</strong>
                  <span>{addressLabel(detail.cc)}</span>
                </div>
              )}
              {(detail.bcc?.length ?? 0) > 0 && (
                <div>
                  <strong>BCC</strong>
                  <span>{addressLabel(detail.bcc || [])}</span>
                </div>
              )}
              {detail.replyTo.length > 0 && (
                <div>
                  <strong>{t('Antwort an')}</strong>
                  <span>{addressLabel(detail.replyTo)}</span>
                </div>
              )}
            </div>
          )}
          {detail && <CryptoBadges detail={detail} onReload={props.onRetry} />}
          {detail?.security && <SecurityBanner report={detail.security} />}
          {props.snoozedUntil && (
            <div className="reader-security scheduled">
              <AlarmClock size={14} />
              <span>{t('Zurückgestellt bis {when}.', { when: fullDateLabel(props.snoozedUntil) })}</span>
              {props.onWake && (
                <button className="text-button" onClick={props.onWake}>
                  {t('Jetzt zurückholen')}
                </button>
              )}
            </div>
          )}
          {detail?.scheduledFor && (
            <div className="reader-security scheduled">
              <CalendarClock size={14} />{' '}
              {t('Geplanter Versand: {when}. „Bearbeiten“ hebt die Planung auf.', {
                when: fullDateLabel(detail.scheduledFor)
              })}
            </div>
          )}

          {detail && !detail.stale && (
            <ThreadPanel accountId={accountId} detail={detail} onOpen={props.onOpenThreadMessage} />
          )}

          {detail?.stale && (
            <div className="reader-security offline">
              <CloudOff size={14} />{' '}
              {detail.offlineIndex
                ? t('Offline – Text aus dem lokalen Suchindex (gekürzt, ohne Formatierung und Anhänge).')
                : t('Offline – gespeicherte Ansicht von {time}.', {
                    time: detail.cachedAt
                      ? new Date(detail.cachedAt).toLocaleTimeString(currentLocale(), {
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : t('vorhin')
                  })}
            </div>
          )}

          {detailBusy ? (
            <div className="reader-loading">
              <LoaderCircle className="spin" size={18} /> {t('Nachricht wird geladen …')}
            </div>
          ) : detailError ? (
            <div className="reader-alert">
              <WifiOff size={18} />
              <span>{detailError}</span>
              <button onClick={props.onRetry}>{t('Erneut versuchen')}</button>
            </div>
          ) : detail ? (
            <div className="message-detail">
              {detail.invitation && <InvitationCard accountId={accountId} detail={detail} />}
              {detail.protected && (
                <ProtectedCard key={`${detail.folder}|${detail.uid}`} accountId={accountId} detail={detail} />
              )}
              {detail.unsubscribe && !detail.crypto?.encrypted && (
                <UnsubscribeBar accountId={accountId} detail={detail} onTrash={props.onUnsubscribed} />
              )}
              {!detail.protected && detail.html && detail.text && (
                <div className="body-format-switch" role="group" aria-label={t('Darstellung')}>
                  <button className={!showHtml ? 'active' : ''} onClick={() => setShowTextFor(detail.uid)}>
                    {t('Text')}
                  </button>
                  <button className={showHtml ? 'active' : ''} onClick={() => setShowTextFor(null)}>
                    HTML
                  </button>
                </div>
              )}
              {detail.protected ? null : showHtml ? (
                <>
                  <div className="reader-security">
                    <ShieldCheck size={14} />
                    <span>
                      {t('Geschützte Ansicht · Links fragen vor dem Öffnen nach')}
                      {detail.remoteContent && !allowRemote ? ` · ${t('externe Bilder blockiert')}` : ''}
                    </span>
                    {detail.remoteContent && !allowRemote && (
                      <button className="text-button" onClick={() => setRemoteFor(detail.uid)}>
                        <Image size={13} /> {t('Bilder laden')}
                      </button>
                    )}
                  </div>
                  <iframe
                    className="html-mail-frame"
                    title={t('E-Mail-Inhalt')}
                    sandbox="allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                    srcDoc={htmlDocument}
                  />
                </>
              ) : (
                <div className="plain-mail-text">{detail.text || t('Diese Nachricht enthält keinen Text.')}</div>
              )}
              {(detail.textTruncated || detail.htmlTruncated) && !detail.offlineIndex && (
                <div className="reader-security">{t('Sehr lange Nachricht – die Anzeige wurde gekürzt.')}</div>
              )}
              {visibleAttachments.length > 0 && (
                <div className="attachment-list">
                  <div className="attachment-heading">
                    <Paperclip size={15} />
                    <span>{t('Anhänge')}</span>
                    <span>{visibleAttachments.length}</span>
                  </div>
                  {visibleAttachments.map(att => {
                    const isKey = detail.pgpKeys?.includes(att.index);
                    const risky = dangerous.includes(att.filename);
                    return (
                      <div key={att.index} className={`attachment-item ${risky ? 'risky' : ''}`}>
                        {risky ? <AlertTriangle size={18} /> : <FileText size={18} />}
                        <span className="attachment-data">
                          <strong>{att.filename}</strong>
                          <small>
                            {prettySize(att.size)}
                            {risky ? ` · ${t('gefährlicher Dateityp')}` : ''}
                          </small>
                        </span>
                        {isKey && (
                          <button className="btn small" onClick={() => void importKey(att.index)}>
                            <KeyRound size={14} /> {t('Schlüssel importieren')}
                          </button>
                        )}
                        {PREVIEWABLE.test(att.mimeType) && (
                          <button
                            className="icon-button"
                            title={t('Vorschau')}
                            aria-label={t('Vorschau: {name}', { name: att.filename })}
                            onClick={() => setPreview(att)}
                          >
                            <Eye size={17} />
                          </button>
                        )}
                        <button
                          className="icon-button"
                          title={t('Herunterladen – unbekannte Dateien vor dem Öffnen prüfen')}
                          aria-label={t('{name} herunterladen', { name: att.filename })}
                          onClick={() => void downloadAttachment(att)}
                        >
                          <Download size={17} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
          {preview && detail && (
            <AttachmentPreview url={attUrl(preview, true)} att={preview} onClose={() => setPreview(null)} />
          )}
        </div>
      ) : (
        <div className="reader-empty">
          <h2>
            {t('Keine Nachricht ausgewählt')}
            <span className="period">.</span>
          </h2>
          <p>{t('Wähle links eine Nachricht aus. J/K blättert, ? zeigt alle Tastenkürzel.')}</p>
        </div>
      )}
    </section>
  );
}
