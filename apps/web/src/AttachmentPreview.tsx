import { useEffect, useState } from 'react';
import { Download, FileText, LoaderCircle, X } from 'lucide-react';
import { download } from './api';
import { prettySize } from './format';
import { useT } from './i18n';
import { useFocusTrap } from './ui/focus';
import type { Attachment } from './types';

/** Preview of an image, PDF or text attachment (mail and calendar). `url` ends with `&inline=1`. */
export default function AttachmentPreview({
  url,
  att,
  onClose
}: {
  url: string;
  att: Attachment;
  onClose: () => void;
}) {
  const { t } = useT();
  const trap = useFocusTrap<HTMLDivElement>();
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
        ref={trap}
        className="preview-panel"
        tabIndex={-1}
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
