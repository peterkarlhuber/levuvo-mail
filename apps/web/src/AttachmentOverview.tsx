import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  MailOpen,
  Paperclip,
  Search,
  X
} from 'lucide-react';
import { accountPath, ApiError, download, getJson } from './api';
import { useUi } from './ConfirmDialog';
import { dateLabel, prettySize } from './format';
import { useT } from './i18n';
import type { Detail, Folder } from './types';

export type AttachmentItem = {
  uid: number;
  folder: string;
  filename: string;
  mimeType: string;
  size: number;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string | null;
};

type AttachmentPage = {
  items: AttachmentItem[];
  hasMore: boolean;
  nextBeforeUid: number | null;
};

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function FileIcon({ item }: { item: AttachmentItem }) {
  const type = item.mimeType;
  const name = item.filename.toLowerCase();
  const Icon = type.startsWith('image/')
    ? FileImage
    : /pdf|msword|wordprocessing|opendocument\.text|^text\//.test(type)
      ? FileText
      : /sheet|excel|csv/.test(type) || /\.(xlsx?|ods|csv)$/.test(name)
        ? FileSpreadsheet
        : /zip|rar|7z|tar|gzip/.test(type) || /\.(zip|rar|7z|tgz|gz)$/.test(name)
          ? FileArchive
          : File;
  return <Icon size={20} strokeWidth={1.7} aria-hidden="true" />;
}

/**
 * All files in a folder at a glance, newest first. The search field filters by file name,
 * sender and subject; an e-mail address shows only files exchanged with that contact.
 */
export default function AttachmentOverview({
  accountId,
  folders,
  initialFolder,
  folderLabel,
  onOpenMessage
}: {
  accountId: string;
  folders: Folder[];
  initialFolder: string;
  folderLabel: (f?: Folder) => string;
  onOpenMessage: (folder: string, uid: number) => void;
}) {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [folder, setFolder] = useState(initialFolder);
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<AttachmentItem[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const url = useCallback(
    (beforeUid: number | null) => {
      const value = term.trim();
      const params = new URLSearchParams({ folder });
      if (EMAIL.test(value)) params.set('contact', value);
      else if (value.length >= 2) params.set('q', value);
      if (beforeUid) params.set('beforeUid', String(beforeUid));
      return `/api/attachments?${params.toString()}`;
    },
    [folder, term]
  );

  useEffect(() => {
    const mine = ++seq.current;
    setItems(null);
    setError('');
    const timer = window.setTimeout(
      () => {
        getJson<AttachmentPage>(url(null), accountId)
          .then(page => {
            if (mine !== seq.current) return;
            setItems(page.items);
            setNext(page.hasMore ? page.nextBeforeUid : null);
          })
          .catch(err => {
            if (mine !== seq.current) return;
            setItems([]);
            setError((err as Error).message);
          });
      },
      term ? 300 : 0
    );
    return () => window.clearTimeout(timer);
  }, [url, accountId, term]);

  async function loadMore() {
    if (!next) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await getJson<AttachmentPage>(url(next), accountId);
      if (mine !== seq.current) return;
      setItems(prev => [...(prev || []), ...page.items]);
      setNext(page.hasMore ? page.nextBeforeUid : null);
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setLoadingMore(false);
    }
  }

  async function save(item: AttachmentItem) {
    try {
      // The message is read without marking it as read; its attachment list gives the index.
      const detail = await getJson<Detail>(
        `/api/messages/${item.uid}?folder=${encodeURIComponent(item.folder)}`,
        accountId
      );
      const att =
        detail.attachments.find(a => a.filename === item.filename && !a.embedded) ||
        detail.attachments.find(a => a.filename === item.filename);
      if (!att) {
        toast({ text: t('Anhang nicht gefunden.'), kind: 'error' });
        return;
      }
      const dangerous = detail.security?.checks.some(
        c => c.code === 'dangerous_attachment' && String(c.filename) === att.filename
      );
      if (
        dangerous &&
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
      download(
        accountPath(
          `/api/messages/${item.uid}/attachments/${att.index}?folder=${encodeURIComponent(item.folder)}`,
          accountId
        )
      );
    } catch (err) {
      toast({ text: err instanceof ApiError ? err.message : t('Download fehlgeschlagen.'), kind: 'error' });
    }
  }

  const selectable = folders.filter(f => f.selectable !== false);
  const contact = EMAIL.test(term.trim()) ? term.trim() : '';

  return (
    <div className="attachment-overview">
      <div className="attachment-filters">
        <select
          aria-label={t('Ordner')}
          value={folder}
          onChange={e => setFolder(e.target.value)}
          className="attachment-folder"
        >
          {selectable.map(f => (
            <option key={f.path} value={f.path}>
              {folderLabel(f)}
            </option>
          ))}
        </select>
        <label className="searchbox">
          <Search size={16} />
          <input
            type="search"
            aria-label={t('Anhänge durchsuchen')}
            placeholder={t('Dateiname, Absender oder E-Mail-Adresse')}
            value={term}
            maxLength={120}
            onChange={e => setTerm(e.target.value)}
          />
          {term && (
            <button aria-label={t('Suche löschen')} onClick={() => setTerm('')}>
              <X size={14} />
            </button>
          )}
        </label>
      </div>
      {contact && <p className="attachment-hint">{t('Nur Dateien von und an {email}', { email: contact })}</p>}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
        </div>
      )}
      {!items ? (
        <div className="empty-list">
          <LoaderCircle className="spin" size={20} />
        </div>
      ) : !items.length && !error ? (
        <div className="empty-list">
          <Paperclip size={24} />
          <h3>{t('Keine Anhänge gefunden.')}</h3>
          <p>
            {next
              ? t('In den neuesten Nachrichten ist nichts dabei. Ältere Nachrichten durchsuchen?')
              : t('In diesem Ordner gibt es keine passenden Dateien.')}
          </p>
          {next && (
            <button className="btn small" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <LoaderCircle className="spin" size={14} /> : null} {t('Ältere durchsuchen')}
            </button>
          )}
        </div>
      ) : (
        <div className="message-list attachment-list" role="list" aria-label={t('Anhänge')}>
          {items.map(item => (
            <div key={`${item.uid}:${item.filename}`} className="attachment-row" role="listitem">
              <span className="attachment-icon">
                <FileIcon item={item} />
              </span>
              <div className="followup-main">
                <strong title={item.filename}>{item.filename}</strong>
                <span>
                  {item.fromName || item.fromEmail} · {item.subject || t('(Ohne Betreff)')}
                </span>
                <small>
                  {prettySize(item.size)} · {dateLabel(item.date)}
                </small>
              </div>
              <div className="followup-actions">
                <button
                  className="icon-button"
                  title={t('Nachricht öffnen')}
                  aria-label={t('Nachricht öffnen')}
                  onClick={() => onOpenMessage(item.folder, item.uid)}
                >
                  <MailOpen size={15} />
                </button>
                <button
                  className="icon-button"
                  title={t('Herunterladen')}
                  aria-label={t('{name} herunterladen', { name: item.filename })}
                  onClick={() => void save(item)}
                >
                  <Download size={15} />
                </button>
              </div>
            </div>
          ))}
          {next && (
            <div className="load-more">
              <button onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? <LoaderCircle className="spin" size={14} /> : null} {t('Ältere Nachrichten durchsuchen')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
