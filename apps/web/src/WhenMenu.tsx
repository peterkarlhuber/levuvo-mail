import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useT } from './i18n';
import { toLocalInput, whenPresets, type WhenPreset } from './when';

type Props = {
  title: string;
  note?: string;
  className?: string;
  onPick: (date: Date) => void;
  onClose: () => void;
};

/** Menu with quick times (later today, tonight, tomorrow, Monday, in a week) and a custom time. */
export default function WhenMenu({ title, note, className = '', onPick, onClose }: Props) {
  const { t, locale } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState(() => toLocalInput(new Date(Date.now() + 24 * 3_600_000)));
  const presets = whenPresets();
  const labels: Record<WhenPreset['key'], string> = {
    later: t('Später heute'),
    evening: t('Heute Abend'),
    tomorrow: t('Morgen früh'),
    monday: t('Montag früh'),
    nextWeek: t('In einer Woche')
  };
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  const customDate = new Date(custom);
  const customValid = !Number.isNaN(customDate.getTime()) && customDate.getTime() > Date.now() + 60_000;
  return (
    <div ref={ref} className={`menu when-menu ${className}`} role="menu" aria-label={title}>
      <div className="menu-title">
        <Clock size={13} /> {title}
      </div>
      {presets.map(p => (
        <button key={p.key} role="menuitem" onClick={() => onPick(p.date)}>
          {labels[p.key]}
          <small>{fmt.format(p.date)}</small>
        </button>
      ))}
      <div className="menu-custom">
        <input
          type="datetime-local"
          value={custom}
          onChange={e => setCustom(e.target.value)}
          aria-label={t('Datum und Uhrzeit')}
        />
        <button className="btn small" disabled={!customValid} onClick={() => onPick(customDate)}>
          {t('Festlegen')}
        </button>
      </div>
      {note && <p className="menu-note">{note}</p>}
    </div>
  );
}
