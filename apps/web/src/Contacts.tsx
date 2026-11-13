import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Cake,
  Contact2,
  Download,
  LoaderCircle,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { download, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { initials } from './format';
import { useT } from './i18n';
import { CloudConsentBanner, isConsentError, type CloudError } from './CloudConsent';
import type { AddressBook, Contact, ContactEntry } from './types';

const EMPTY: Contact = {
  uid: '',
  name: '',
  firstName: '',
  lastName: '',
  emails: [{ value: '', type: 'work' }],
  phones: [],
  organization: '',
  title: '',
  address: '',
  birthday: '',
  note: ''
};

function EntryList({
  label,
  entries,
  onChange,
  type
}: {
  label: string;
  entries: ContactEntry[];
  onChange: (e: ContactEntry[]) => void;
  type: 'email' | 'tel';
}) {
  const { t } = useT();
  const types =
    type === 'email'
      ? [
          ['work', t('Arbeit')],
          ['home', t('Privat')],
          ['other', t('Andere')]
        ]
      : [
          ['cell', t('Mobil')],
          ['work', t('Arbeit')],
          ['home', t('Privat')],
          ['other', t('Andere')]
        ];
  return (
    <div className="entry-list">
      <span className="entry-label">{label}</span>
      {entries.map((e, i) => (
        <div className="entry-row" key={i}>
          <select
            aria-label={t('Art')}
            value={e.type}
            onChange={ev => onChange(entries.map((x, j) => (j === i ? { ...x, type: ev.target.value } : x)))}
          >
            {types.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            type={type}
            value={e.value}
            aria-label={label}
            onChange={ev => onChange(entries.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={t('Entfernen')}
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {entries.length < 10 && (
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([...entries, { value: '', type: type === 'email' ? 'work' : 'cell' }])}
        >
          + {label}
        </button>
      )}
    </div>
  );
}

export default function ContactsModule({
  onCompose,
  onOpenSettings
}: {
  onCompose: (to: string) => void;
  onOpenSettings: () => void;
}) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [data, setData] = useState<{
    contacts: Contact[];
    addressBooks: AddressBook[];
    errors: CloudError[];
  } | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<(Contact & { book: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await getJson('/api/contacts/list'));
    } catch (e) {
      setError((e as Error).message);
      setData(d => d ?? { contacts: [], addressBooks: [], errors: [] });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const key = (c: Contact) => c.url || c.uid;
  const contacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.contacts || []).filter(
      c =>
        !q ||
        [c.name, c.organization, ...c.emails.map(e => e.value), ...c.phones.map(p => p.value)]
          .join(' ')
          .toLowerCase()
          .includes(q)
    );
    return list.sort((a, b) =>
      (a.lastName || a.name).localeCompare(b.lastName || b.name, locale, { sensitivity: 'base' })
    );
  }, [data, query, locale]);
  const current = contacts.find(c => key(c) === selected) || null;
  const books = data?.addressBooks || [];

  function startNew() {
    if (!books.length) {
      toast({ text: t('Kein Adressbuch verbunden.'), kind: 'error' });
      return;
    }
    setError('');
    setEdit({ ...EMPTY, book: `${books[0].accountId}|${books[0].url}` });
  }
  async function save() {
    if (!edit) return;
    setBusy(true);
    setError('');
    const [accountId, ...rest] = edit.book.split('|');
    const contact = {
      ...edit,
      emails: edit.emails.filter(e => e.value.trim()),
      phones: edit.phones.filter(p => p.value.trim())
    };
    try {
      await postJson(
        '/api/contacts/save',
        {
          accountId: edit.accountId || accountId,
          addressBookUrl: edit.addressBookUrl || rest.join('|'),
          url: edit.url,
          etag: edit.etag,
          uid: edit.uid || undefined,
          contact
        },
        'contacts-v1'
      );
      setEdit(null);
      await load();
      toast({ text: t('Kontakt gespeichert.'), kind: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Contact) {
    if (!(await confirm({ title: t('Kontakt löschen?'), message: c.name, confirmLabel: t('Löschen'), danger: true })))
      return;
    try {
      await postJson('/api/contacts/delete', { accountId: c.accountId, url: c.url, etag: c.etag }, 'contacts-v1');
      setSelected(null);
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  async function importFile(file?: File) {
    if (!file || !books.length) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ text: t('Datei zu groß (max. 5 MB).'), kind: 'error' });
      return;
    }
    setBusy(true);
    try {
      const r = await postJson<{ imported: number }>(
        '/api/contacts/import',
        { accountId: books[0].accountId, addressBookUrl: books[0].url, vcf: await file.text() },
        'contacts-v1'
      );
      toast({ text: t('{count} Kontakte importiert.', { count: r.imported }), kind: 'success' });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const otherErrors = data ? data.errors.filter(e => !isConsentError(e)) : [];
  if (!data)
    return (
      <div className="module-loading">
        <LoaderCircle className="spin" size={18} />
      </div>
    );
  if (!books.length)
    return (
      <div className="empty-module">
        <Contact2 size={34} />
        <h2>
          {t('Kontakte verbinden')}
          <span className="period">.</span>
        </h2>
        <p>
          {t(
            'Microsoft 365 und Google werden über das angemeldete E-Mail-Konto eingebunden, andere Anbieter per CardDAV. Adressvorschläge beim Schreiben funktionieren auch ohne – aus deinen bisherigen E-Mails.'
          )}
        </p>
        <CloudConsentBanner errors={data.errors} onDone={load} />
        {(error || otherErrors[0]) && <p className="modal-error">{error || otherErrors[0].error}</p>}
        <button className="btn primary" onClick={onOpenSettings}>
          {t('Adressbuch verbinden')}
        </button>
      </div>
    );

  const field = (k: 'firstName' | 'lastName' | 'organization' | 'title' | 'address', label: string) => (
    <label>
      {label}
      <input value={edit?.[k] || ''} onChange={e => edit && setEdit({ ...edit, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="contacts-module">
      <aside className="contacts-list">
        <div className="contacts-head">
          <h1>
            {t('Kontakte')}
            <span className="period">.</span>
          </h1>
          <button className="icon-button" title={t('Neuer Kontakt')} aria-label={t('Neuer Kontakt')} onClick={startNew}>
            <Plus size={18} />
          </button>
        </div>
        <label className="searchbox">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder={t('Kontakte durchsuchen')}
            aria-label={t('Kontakte durchsuchen')}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <div className="contacts-tools">
          <span className="muted">{t('{count} Kontakte', { count: contacts.length })}</span>
          <button
            className="icon-button"
            title={t('Importieren (.vcf)')}
            aria-label={t('Importieren (.vcf)')}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} />
          </button>
          <button
            className="icon-button"
            title={t('Alle exportieren (.vcf)')}
            aria-label={t('Alle exportieren (.vcf)')}
            onClick={() => download('/api/contacts/export')}
          >
            <Download size={15} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".vcf,text/vcard"
            hidden
            onChange={e => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <div className="contact-rows" role="list">
          {contacts.map(c => (
            <button
              role="listitem"
              key={key(c)}
              className={`contact-row ${selected === key(c) ? 'selected' : ''}`}
              onClick={() => {
                setSelected(key(c));
                setEdit(null);
              }}
            >
              <span className="reader-avatar small">{initials(c.name)}</span>
              <span>
                <strong>{c.name}</strong>
                <small>{c.emails[0]?.value || c.organization || c.phones[0]?.value}</small>
              </span>
            </button>
          ))}
          {!contacts.length && (
            <p className="muted center">{query ? t('Keine Treffer.') : t('Noch keine Kontakte.')}</p>
          )}
        </div>
      </aside>
      <main className="contact-detail">
        <CloudConsentBanner errors={data.errors} onDone={load} />
        {otherErrors.length > 0 && (
          <div className="error-banner">
            <span>{otherErrors[0].error}</span>
          </div>
        )}
        {edit ? (
          <form
            className="contact-form"
            onSubmit={e => {
              e.preventDefault();
              void save();
            }}
          >
            <h2>{edit.url ? t('Kontakt bearbeiten') : t('Neuer Kontakt')}</h2>
            {!edit.url && books.length > 1 && (
              <label>
                {t('Adressbuch')}
                <select value={edit.book} onChange={e => setEdit({ ...edit, book: e.target.value })}>
                  {books.map(b => (
                    <option key={`${b.accountId}|${b.url}`} value={`${b.accountId}|${b.url}`}>
                      {b.name} · {b.accountLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="managed-field-grid">
              {field('firstName', t('Vorname'))}
              {field('lastName', t('Nachname'))}
              {field('organization', t('Firma'))}
              {field('title', t('Position'))}
            </div>
            <EntryList
              label={t('E-Mail')}
              type="email"
              entries={edit.emails}
              onChange={emails => setEdit({ ...edit, emails })}
            />
            <EntryList
              label={t('Telefon')}
              type="tel"
              entries={edit.phones}
              onChange={phones => setEdit({ ...edit, phones })}
            />
            <div className="managed-field-grid">
              {field('address', t('Adresse'))}
              <label>
                {t('Geburtstag')}
                <input
                  type="date"
                  value={edit.birthday}
                  onChange={e => setEdit({ ...edit, birthday: e.target.value })}
                />
              </label>
            </div>
            <label>
              {t('Notiz')}
              <textarea rows={3} value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} />
            </label>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
            <div className="managed-form-buttons">
              <button type="button" className="btn" onClick={() => setEdit(null)}>
                {t('Abbrechen')}
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy && <LoaderCircle size={15} className="spin" />} {t('Speichern')}
              </button>
            </div>
          </form>
        ) : current ? (
          <div className="contact-card">
            <div className="contact-hero">
              <span className="reader-avatar large">{initials(current.name)}</span>
              <div>
                <h2>{current.name}</h2>
                {(current.title || current.organization) && (
                  <p className="muted">{[current.title, current.organization].filter(Boolean).join(' · ')}</p>
                )}
              </div>
            </div>
            <div className="contact-actions">
              {current.emails[0] && (
                <button className="btn primary" onClick={() => onCompose(current.emails[0].value)}>
                  <Mail size={15} /> {t('E-Mail schreiben')}
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  setError('');
                  setEdit({
                    ...current,
                    emails: current.emails.length ? current.emails : [{ value: '', type: 'work' }],
                    book: `${current.accountId}|${current.addressBookUrl}`
                  });
                }}
              >
                {t('Bearbeiten')}
              </button>
              <button className="btn" aria-label={t('Kontakt löschen')} onClick={() => void remove(current)}>
                <Trash2 size={15} />
              </button>
            </div>
            <dl className="contact-fields">
              {current.emails.map((e, i) => (
                <div key={`e${i}`}>
                  <dt>
                    <Mail size={14} />
                  </dt>
                  <dd>
                    <button className="link-button" onClick={() => onCompose(e.value)}>
                      {e.value}
                    </button>
                    <small>{e.type}</small>
                  </dd>
                </div>
              ))}
              {current.phones.map((p, i) => (
                <div key={`p${i}`}>
                  <dt>
                    <Phone size={14} />
                  </dt>
                  <dd>
                    <a href={`tel:${p.value.replace(/[^\d+]/g, '')}`}>{p.value}</a>
                    <small>{p.type}</small>
                  </dd>
                </div>
              ))}
              {current.organization && (
                <div>
                  <dt>
                    <Building2 size={14} />
                  </dt>
                  <dd>{current.organization}</dd>
                </div>
              )}
              {current.address && (
                <div>
                  <dt>
                    <MapPin size={14} />
                  </dt>
                  <dd>{current.address}</dd>
                </div>
              )}
              {current.birthday && (
                <div>
                  <dt>
                    <Cake size={14} />
                  </dt>
                  <dd>
                    {new Date(`${current.birthday}T12:00:00`).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric'
                    })}
                  </dd>
                </div>
              )}
              {current.note && (
                <div>
                  <dt>
                    <StickyNote size={14} />
                  </dt>
                  <dd className="pre">{current.note}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="reader-empty">
            <h2>
              {t('Kein Kontakt ausgewählt')}
              <span className="period">.</span>
            </h2>
            <p>{t('Wähle links einen Kontakt oder lege einen neuen an.')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
