// Contact card in the reader: who the sender is (address book), the latest mails with them,
// shared appointments and the files exchanged (from the attachment overview). Everything is read from this computer
// (encrypted search index, connected calendars and address books); nothing is looked up online.
import { useEffect, useState } from 'react';
import { Building2, CalendarDays, Mail, Paperclip, Phone, X } from 'lucide-react';
import { getJson } from './api';
import { useT } from './i18n';
import type { AttachmentItem } from './AttachmentOverview';
import { prettySize } from './format';
import { pickContact, sharedEvents, type ContactMail } from './contact-card';
import type { CalendarEvent, Contact } from './types';

const DAY = 86_400_000;

export default function ContactCard({
  accountId,
  email,
  name,
  currentUid,
  onOpenMail,
  onClose
}: {
  accountId: string;
  email: string;
  name: string;
  currentUid: number | null;
  onOpenMail: (folder: string, uid: number) => void;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [contact, setContact] = useState<Contact | null>(null);
  const [mails, setMails] = useState<ContactMail[] | null>(null);
  const [files, setFiles] = useState<AttachmentItem[] | null>(null);
  const [events, setEvents] = useState<{ upcoming: CalendarEvent[]; past: CalendarEvent[] } | null>(null);

  useEffect(() => {
    let live = true;
    getJson<{ contacts: Contact[] }>('/api/contacts/list')
      .then(d => live && setContact(pickContact(d.contacts || [], email)))
      .catch(() => {});
    const inbox = () =>
      getJson<{ messages: ContactMail[] }>(
        `/api/search?folder=INBOX&q=${encodeURIComponent(email)}&limit=20`,
        accountId
      ).then(d => d.messages.map(m => ({ ...m, folder: m.folder || 'INBOX' })));
    // The encrypted index covers all folders; while it is still being built (or switched off)
    // the inbox is searched on the server instead.
    getJson<{ messages: ContactMail[] }>(
      `/api/search/local?account=${encodeURIComponent(accountId)}&q=${encodeURIComponent(email)}`
    )
      .then(d => (d.messages.some(m => m.uid !== currentUid) ? d.messages : inbox()))
      .catch(inbox)
      .then(list => live && setMails(list))
      .catch(() => live && setMails([]));
    // Same source as the attachment overview: files in the inbox exchanged with this address.
    getJson<{ items: AttachmentItem[] }>(
      `/api/attachments?folder=INBOX&contact=${encodeURIComponent(email)}`,
      accountId
    )
      .then(d => live && setFiles(d.items || []))
      .catch(() => live && setFiles([]));
    const now = Date.now();
    getJson<{ events: CalendarEvent[] }>(
      `/api/calendar/events?from=${new Date(now - 180 * DAY).toISOString()}&to=${new Date(now + 180 * DAY).toISOString()}`
    )
      .then(d => live && setEvents(sharedEvents(d.events || [], email, new Date(now))))
      .catch(() => live && setEvents({ upcoming: [], past: [] }));
    return () => {
      live = false;
    };
    // currentUid only filters the result; a new message gets a new card anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, email]);

  const others = (mails || []).filter(m => m.uid !== currentUid);
  const recent = others.slice(0, 5);
  const fileList = (files || []).slice(0, 5);
  const withFiles = others.filter(m => m.hasAttachments).slice(0, 5);
  const day = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
      : '';
  const eventWhen = (e: CalendarEvent) =>
    e.allDay
      ? new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
          new Date(`${e.start}T12:00:00`)
        )
      : new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(e.start));
  const displayName = contact?.name || name || email;
  const mailRow = (m: ContactMail) => (
    <li key={`${m.folder}|${m.uid}`}>
      <button className="sender-card-link" onClick={() => onOpenMail(m.folder, m.uid)}>
        <span>{m.subject || t('(Ohne Betreff)')}</span>
        <small>{day(m.date)}</small>
      </button>
    </li>
  );
  const eventRow = (e: CalendarEvent) => (
    <li key={`${e.url}|${e.start}`}>
      <span className="sender-card-event">
        <span>{e.summary || t('(Ohne Titel)')}</span>
        <small>{eventWhen(e)}</small>
      </span>
    </li>
  );

  return (
    <aside className="sender-card" aria-label={t('Kontaktkarte')}>
      <header>
        <div>
          <strong>{displayName}</strong>
          <a href={`mailto:${email}`}>{email}</a>
          {contact && (contact.organization || contact.title) && (
            <span className="muted">
              <Building2 size={12} /> {[contact.title, contact.organization].filter(Boolean).join(' · ')}
            </span>
          )}
          {contact?.phones[0] && (
            <span className="muted">
              <Phone size={12} /> {contact.phones[0].value}
            </span>
          )}
          {!contact && <small className="muted">{t('Nicht im Adressbuch')}</small>}
        </div>
        <button className="icon-button" aria-label={t('Schließen')} title={t('Schließen')} onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <section>
        <h4>
          <Mail size={13} /> {t('Letzte E-Mails')}
        </h4>
        {mails === null ? (
          <small className="muted">{t('Wird geladen …')}</small>
        ) : recent.length ? (
          <ul>{recent.map(mailRow)}</ul>
        ) : (
          <small className="muted">{t('Keine weiteren E-Mails gefunden.')}</small>
        )}
      </section>

      <section>
        <h4>
          <CalendarDays size={13} /> {t('Gemeinsame Termine')}
        </h4>
        {events === null ? (
          <small className="muted">{t('Wird geladen …')}</small>
        ) : events.upcoming.length || events.past.length ? (
          <ul>
            {events.upcoming.map(eventRow)}
            {events.past.length > 0 && <li className="sender-card-sub">{t('Vergangen')}</li>}
            {events.past.map(eventRow)}
          </ul>
        ) : (
          <small className="muted">{t('Keine gemeinsamen Termine.')}</small>
        )}
      </section>

      <section>
        <h4>
          <Paperclip size={13} /> {t('Anhänge')}
        </h4>
        {files === null ? (
          <small className="muted">{t('Wird geladen …')}</small>
        ) : fileList.length ? (
          <ul>
            {fileList.map(f => (
              <li key={`${f.folder}|${f.uid}|${f.filename}`}>
                <button
                  className="sender-card-link"
                  title={f.subject || undefined}
                  onClick={() => onOpenMail(f.folder, f.uid)}
                >
                  <span>{f.filename}</span>
                  <small>
                    {prettySize(f.size)} · {day(f.date)}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : withFiles.length ? (
          <ul>{withFiles.map(mailRow)}</ul>
        ) : (
          <small className="muted">{t('Keine Anhänge.')}</small>
        )}
      </section>
    </aside>
  );
}
