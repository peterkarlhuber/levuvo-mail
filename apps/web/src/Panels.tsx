import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useT } from './i18n';

export function useModalFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  return { ref, onKeyDown };
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const modal = useModalFocus(onClose);
  const rows: [string[], string][] = [
    [['J', 'K'], t('Nächste / vorherige Nachricht')],
    [['N'], t('Neue Nachricht')],
    [['R'], t('Antworten')],
    [['A'], t('Allen antworten')],
    [['F'], t('Weiterleiten')],
    [['U'], t('Gelesen / ungelesen')],
    [['S'], t('Markieren (Stern)')],
    [['E'], t('Archivieren')],
    [['B'], t('Zurückstellen')],
    [['!'], t('Spam / kein Spam')],
    [[t('Entf')], t('In den Papierkorb')],
    [['P'], t('Drucken / als PDF')],
    [['/'], t('Suche')],
    [[t('Strg/⌘'), 'K'], t('Befehle')],
    [[t('Strg/⌘'), 'Enter'], t('Senden (im Editor)')],
    [['Alt', '1 · 2 · 3'], t('E-Mail · Kalender · Kontakte')],
    [['Alt', ','], t('Einstellungen')],
    [['Esc'], t('Schließen / Auswahl aufheben')],
    [['?'], t('Diese Übersicht')]
  ];
  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card shortcut-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('Tastenkürzel')}
        tabIndex={-1}
        {...modal}
      >
        <button className="modal-close icon-button" onClick={onClose} aria-label={t('Schließen')}>
          <X size={18} />
        </button>
        <h2>
          {t('Tastenkürzel')}
          <span className="period">.</span>
        </h2>
        <dl className="shortcut-list">
          {rows.map(([keys, label]) => (
            <div key={label} className="shortcut-row">
              <dt>
                {keys.map(k => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
