// Toolbar above the message list: select-all checkbox, bulk actions or count line and filter
// chips. Split out of MailInstance (ARC-LEV-005).
import { useState } from 'react';
import { AlarmClock, Archive, CheckCheck, Mail, Paperclip, ShieldAlert, Star, Trash2, X } from 'lucide-react';
import WhenMenu from '../WhenMenu';
import { useT } from '../i18n';
import type { ReaderAction } from '../Reader';
import type { Filter } from './list-state';

type Props = {
  /** Bulk selection and filter chips exist only for real folder lists. */
  selectable: boolean;
  allChecked: boolean;
  visibleCount: number;
  checkedCount: number;
  countLabel: string;
  filter: Filter;
  writeEnabled: boolean;
  actionBusy: boolean;
  archiveExists: boolean;
  isJunk: boolean;
  isTrash: boolean;
  isDraftFolder: boolean;
  onCheckAll: (checked: boolean) => void;
  onClearChecked: () => void;
  onFilter: (filter: Filter) => void;
  onBulkAction: (action: ReaderAction) => void;
  onBulkSnooze: (until: Date) => void;
};

export default function ListToolbar(p: Props) {
  const { t } = useT();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const locked = !p.writeEnabled || p.actionBusy;
  const filters: { id: Filter; label: string; icon?: typeof Star }[] = [
    { id: 'all', label: t('Alle') },
    { id: 'unread', label: t('Ungelesen') },
    { id: 'flagged', label: t('Markiert'), icon: Star },
    { id: 'attachments', label: t('Anhang'), icon: Paperclip }
  ];
  const bulk = (action: ReaderAction, label: string, Icon: typeof Star, disabled = false) => (
    <button disabled={locked || disabled} onClick={() => p.onBulkAction(action)} title={label} aria-label={label}>
      <Icon size={14} />
    </button>
  );
  return (
    <div className="list-toolbar">
      {p.selectable && (
        <label className="select-all">
          <input
            type="checkbox"
            checked={p.allChecked}
            onChange={e => p.onCheckAll(e.target.checked)}
            disabled={!p.visibleCount || p.actionBusy}
            aria-label={t('Alle sichtbaren auswählen')}
          />
        </label>
      )}
      {p.checkedCount > 0 ? (
        <div className="bulk-toolbar" aria-label={t('Sammelaktionen')}>
          <span aria-live="polite">{p.countLabel}</span>
          {bulk('markRead', t('Als gelesen markieren'), CheckCheck)}
          {bulk('markUnread', t('Als ungelesen markieren'), Mail)}
          {bulk('flag', t('Markieren'), Star)}
          {bulk('archive', t('Archivieren'), Archive, !p.archiveExists)}
          {bulk(p.isJunk ? 'notSpam' : 'spam', p.isJunk ? t('Kein Spam') : t('Als Spam markieren'), ShieldAlert)}
          {bulk('trash', t('In den Papierkorb'), Trash2, p.isTrash)}
          <span className="menu-anchor">
            <button
              disabled={locked || p.isDraftFolder}
              onClick={() => setSnoozeOpen(!snoozeOpen)}
              title={t('Zurückstellen')}
              aria-label={t('Zurückstellen')}
              aria-expanded={snoozeOpen}
            >
              <AlarmClock size={14} />
            </button>
            {snoozeOpen && (
              <WhenMenu
                title={t('Zurückstellen bis')}
                onClose={() => setSnoozeOpen(false)}
                onPick={date => {
                  setSnoozeOpen(false);
                  p.onBulkSnooze(date);
                }}
              />
            )}
          </span>
          <button
            disabled={p.actionBusy}
            onClick={p.onClearChecked}
            title={t('Auswahl aufheben')}
            aria-label={t('Auswahl aufheben')}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <span className="list-count" aria-live="polite">
            {p.countLabel}
          </span>
          {p.selectable && (
            <div className="filter-chips" role="group" aria-label={t('Filter')}>
              {filters.map(f => (
                <button
                  key={f.id}
                  className={p.filter === f.id ? 'active' : ''}
                  aria-pressed={p.filter === f.id}
                  onClick={() => p.onFilter(f.id)}
                >
                  {f.icon && <f.icon size={12} />}
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
