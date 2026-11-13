import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarDays,
  CircleHelp,
  Contact2,
  FileStack,
  Folder,
  Keyboard,
  Mail,
  Monitor,
  Moon,
  PenLine,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  type LucideIcon
} from 'lucide-react';
import { currentFolders, matchScore, sendMailCommand } from './command-bus';
import { useT } from './i18n';
import { usePrefs } from './prefs';
import type { Module, SettingsTab } from './App';
import type { AccountItem } from './types';

type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
};

/**
 * Ctrl/⌘ + K: one place to reach everything – write, search, jump to a folder or account,
 * switch area, open a settings page or change the design – by typing a few letters.
 */
export default function CommandPalette({
  accounts,
  activeAccountId,
  onModule,
  onSettings,
  onAccount
}: {
  accounts: AccountItem[];
  activeAccountId: string;
  onModule: (m: Module) => void;
  onSettings: (tab: SettingsTab) => void;
  onAccount: (id: string) => void;
}) {
  const { t } = useT();
  const [prefs, setPrefs] = usePrefs();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const openRef = useRef(false);
  /** Opening and closing always start with an empty query (also when toggled quickly). */
  const show = useCallback((value: boolean) => {
    if (value && !openRef.current) returnFocus.current = document.activeElement as HTMLElement | null;
    openRef.current = value;
    setQuery('');
    setIndex(0);
    setOpen(value);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        show(!openRef.current);
      }
    };
    const onOpen = () => show(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('levuvo:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('levuvo:palette', onOpen);
    };
  }, [show]);
  useLayoutEffect(() => {
    if (open) input.current?.focus();
    else returnFocus.current?.focus?.();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    if (!open) return [];
    const mail = (fn: () => void) => () => {
      onModule('mail');
      window.setTimeout(fn, 0);
    };
    const go = t('Aktionen');
    const out: Command[] = [
      {
        id: 'compose',
        group: go,
        label: t('Neue E-Mail schreiben'),
        hint: 'N',
        icon: PenLine,
        keywords: 'verfassen compose new',
        run: mail(() => sendMailCommand({ type: 'compose' }))
      },
      {
        id: 'search',
        group: go,
        label: t('E-Mails durchsuchen'),
        hint: '/',
        icon: Search,
        keywords: 'finden suche',
        run: mail(() => sendMailCommand({ type: 'search' }))
      },
      {
        id: 'followups',
        group: go,
        label: t('Nachfassen: offene Antworten'),
        icon: BellRing,
        keywords: 'follow up erinnerung',
        run: mail(() => sendMailCommand({ type: 'followups' }))
      },
      {
        id: 'shortcuts',
        group: go,
        label: t('Tastenkürzel anzeigen'),
        hint: '?',
        icon: Keyboard,
        keywords: 'shortcuts tastatur',
        run: mail(() => sendMailCommand({ type: 'shortcuts' }))
      }
    ];
    const folders = currentFolders();
    if (folders.accountId === activeAccountId)
      for (const f of folders.list)
        out.push({
          id: `folder:${f.path}`,
          group: t('Ordner'),
          label: f.label,
          hint: f.unseen ? String(f.unseen) : undefined,
          icon: Folder,
          keywords: `ordner gehe zu ${f.path}`,
          run: mail(() => sendMailCommand({ type: 'folder', path: f.path }))
        });
    if (accounts.length > 1)
      for (const a of accounts)
        out.push({
          id: `account:${a.id}`,
          group: t('Konten'),
          label: a.label,
          hint: a.id === activeAccountId ? t('aktiv') : a.mailbox || undefined,
          icon: UserRound,
          keywords: `konto wechseln ${a.mailbox || ''}`,
          run: () => {
            onModule('mail');
            onAccount(a.id);
          }
        });
    const area = t('Bereiche');
    out.push(
      { id: 'm:mail', group: area, label: t('E-Mail'), hint: 'Alt+1', icon: Mail, run: () => onModule('mail') },
      {
        id: 'm:cal',
        group: area,
        label: t('Kalender'),
        hint: 'Alt+2',
        icon: CalendarDays,
        keywords: 'termine',
        run: () => onModule('calendar')
      },
      {
        id: 'm:con',
        group: area,
        label: t('Kontakte'),
        hint: 'Alt+3',
        icon: Contact2,
        keywords: 'adressbuch',
        run: () => onModule('contacts')
      }
    );
    const set = t('Einstellungen');
    const settings: [SettingsTab, string, LucideIcon, string][] = [
      ['general', t('Allgemein'), Settings2, 'darstellung sprache dichte'],
      ['accounts', t('Konten'), UserRound, 'imap smtp signatur alias'],
      ['templates', t('Vorlagen'), FileStack, 'textbausteine'],
      ['filters', t('Filter & Abwesenheit'), Settings2, 'sieve regeln urlaub'],
      ['dav', t('Kalender & Kontakte'), CalendarDays, 'caldav carddav verbinden'],
      ['security', t('Sicherheit'), ShieldCheck, 'pgp smime verschlüsselung'],
      ['search', t('Suche & Offline'), Search, 'index'],
      ['notifications', t('Mitteilungen'), BellRing, 'benachrichtigung'],
      ['help', t('Hilfe'), CircleHelp, 'handbuch']
    ];
    for (const [tab, label, icon, keywords] of settings)
      out.push({
        id: `s:${tab}`,
        group: set,
        label,
        icon,
        keywords: `einstellungen ${keywords}`,
        run: () => onSettings(tab)
      });
    const design = t('Darstellung');
    out.push(
      {
        id: 'theme:dark',
        group: design,
        label: t('Dunkles Design'),
        icon: Moon,
        hint: prefs.theme === 'dark' ? '✓' : undefined,
        keywords: 'theme dark',
        run: () => setPrefs({ theme: 'dark' })
      },
      {
        id: 'theme:light',
        group: design,
        label: t('Helles Design'),
        icon: Sun,
        hint: prefs.theme === 'light' ? '✓' : undefined,
        keywords: 'theme light',
        run: () => setPrefs({ theme: 'light' })
      },
      {
        id: 'theme:system',
        group: design,
        label: t('Design wie System'),
        icon: Monitor,
        hint: prefs.theme === 'system' ? '✓' : undefined,
        keywords: 'theme system automatisch',
        run: () => setPrefs({ theme: 'system' })
      }
    );
    return out;
  }, [open, t, accounts, activeAccountId, onModule, onSettings, onAccount, prefs.theme, setPrefs]);

  const shown = useMemo(() => {
    if (!query.trim())
      return commands.filter(c => !c.id.startsWith('folder:') || /INBOX$/i.test(c.id) || commands.length < 30);
    return commands
      .map(c => ({ c, s: matchScore(query, c.label, c.keywords) }))
      .filter(x => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map(x => x.c);
  }, [commands, query]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;
  const run = (c?: Command) => {
    if (!c) return;
    show(false);
    c.run();
  };
  const grouped = !query.trim();
  let lastGroup = '';
  return (
    <div className="palette-scrim" onMouseDown={e => e.target === e.currentTarget && show(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('Befehle')}>
        <div className="palette-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('Was möchtest du tun? Ordner, Konto, Einstellung …')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[index] ? `cmd-${index}` : undefined}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex(i => Math.min(shown.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex(i => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(shown[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                show(false);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {!shown.length && <p className="palette-empty">{t('Nichts gefunden.')}</p>}
          {shown.map((c, i) => {
            const header = grouped && c.group !== lastGroup ? c.group : '';
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  id={`cmd-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  className={i === index ? 'active' : ''}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => run(c)}
                >
                  <c.icon size={16} aria-hidden="true" />
                  <span className="palette-label">{c.label}</span>
                  {!grouped && <span className="palette-meta">{c.group}</span>}
                  {c.hint && <kbd>{c.hint}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('auswählen')}
          </span>
          <span>
            <kbd>↵</kbd> {t('ausführen')}
          </span>
          <span>
            <kbd>{navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Strg'}</kbd>
            <kbd>K</kbd> {t('öffnen & schließen')}
          </span>
        </footer>
      </div>
    </div>
  );
}
