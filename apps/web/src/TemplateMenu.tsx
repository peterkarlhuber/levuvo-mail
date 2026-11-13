import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileStack, Plus } from 'lucide-react';
import { getJson } from './api';
import { useT } from './i18n';
import type { Template } from './templates';

/** "Vorlagen" button in the composer: insert a template or save the current message as one. */
export default function TemplateMenu({
  onInsert,
  onSaveCurrent
}: {
  onInsert: (t: Template) => void;
  onSaveCurrent: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Template[] | null>(null);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    getJson<{ templates: Template[] }>('/api/templates')
      .then(d => setItems(d.templates))
      .catch(() => setItems([]));
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const shown = (items || []).filter(
    i => !filter || `${i.name} ${i.subject}`.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="btn small ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={t('Textbausteine und Vorlagen')}
      >
        <FileStack size={14} /> {t('Vorlagen')} <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="menu template-menu left"
          role="menu"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {(items?.length || 0) > 6 && (
            <input
              className="menu-filter"
              placeholder={t('Vorlagen durchsuchen')}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              autoFocus
            />
          )}
          {items === null && <div className="menu-note">{t('Lädt …')}</div>}
          {items !== null && !items.length && (
            <div className="menu-note">
              {t(
                'Noch keine Vorlagen. Speichere eine Nachricht als Vorlage oder lege sie unter Einstellungen → Vorlagen an.'
              )}
            </div>
          )}
          {shown.map(item => (
            <button
              key={item.id}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onInsert(item);
              }}
            >
              {item.name}
              {item.subject && <small>{item.subject}</small>}
            </button>
          ))}
          <button
            role="menuitem"
            className="menu-separator-top"
            onClick={() => {
              setOpen(false);
              onSaveCurrent();
            }}
          >
            <Plus size={14} /> {t('Aktuelle Nachricht als Vorlage speichern')}
          </button>
        </div>
      )}
    </div>
  );
}
