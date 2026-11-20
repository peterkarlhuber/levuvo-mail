import { useCallback, useEffect, useState } from 'react';
import { ASSISTANT_WIDTH, validAssistantWidth } from './assistant-width';

// View preferences only. Never mail content, addresses or credentials.
export type Prefs = {
  density: 'comfortable' | 'compact';
  theme: 'system' | 'dark' | 'light';
  language: 'system' | 'de' | 'en';
  markReadOnOpen: boolean;
  conversations: boolean;
  /** Inbox: newsletters, invoices and notifications collapsed into bundles. */
  bundles: boolean;
  /** Inbox: mail from new senders waits in a screener until accepted or blocked. */
  screening: boolean;
  listWidth: number;
  /** Width of the Levuvo Mail Assistant panel in pixels. */
  assistantWidth: number;
  sendDelay: number;
  calendarView: 'month' | 'week' | 'day' | 'agenda';
  composeMode: 'html' | 'text';
};

export const PREFS_KEY = 'levuvo-mail-prefs-v2';
const KEY = PREFS_KEY;
export const DEFAULT_PREFS: Prefs = {
  density: 'comfortable',
  theme: 'system',
  language: 'system',
  markReadOnOpen: true,
  conversations: false,
  bundles: true,
  screening: false,
  listWidth: 400,
  assistantWidth: ASSISTANT_WIDTH.initial,
  sendDelay: 10,
  calendarView: 'week',
  composeMode: 'html'
};

function read(): Prefs {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || '{}') as Partial<Prefs>;
    return {
      density: v.density === 'compact' ? 'compact' : 'comfortable',
      theme: v.theme === 'dark' || v.theme === 'light' ? v.theme : 'system',
      language: v.language === 'de' || v.language === 'en' ? v.language : 'system',
      markReadOnOpen: v.markReadOnOpen !== false,
      conversations: v.conversations === true,
      bundles: v.bundles !== false,
      screening: v.screening === true,
      listWidth:
        typeof v.listWidth === 'number' && v.listWidth >= 300 && v.listWidth <= 680
          ? v.listWidth
          : DEFAULT_PREFS.listWidth,
      assistantWidth: validAssistantWidth(v.assistantWidth) ? v.assistantWidth : DEFAULT_PREFS.assistantWidth,
      sendDelay: [0, 5, 10, 20, 30].includes(v.sendDelay as number) ? (v.sendDelay as number) : DEFAULT_PREFS.sendDelay,
      calendarView: ['month', 'week', 'day', 'agenda'].includes(v.calendarView as string)
        ? (v.calendarView as Prefs['calendarView'])
        : 'week',
      composeMode: v.composeMode === 'text' ? 'text' : 'html'
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const listeners = new Set<(prefs: Prefs) => void>();
let current: Prefs | null = null;
/** Current preferences outside React (e.g. for translating server messages). */
export const getPrefs = (): Prefs => (current ??= read());

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => (current ??= read()));
  useEffect(() => {
    listeners.add(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    current = { ...(current ?? read()), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* storage blocked */
    }
    listeners.forEach(fn => fn(current!));
  }, []);
  return [prefs, update];
}

/** Preferences for a backup (view settings only). */
export const prefsForBackup = (): Prefs => ({ ...getPrefs() });

/** Takes preferences from a restored backup; they are checked again when read. */
export function restorePrefs(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
    current = null;
  } catch {
    /* storage blocked */
  }
}

/** Applies theme and language to the document root. */
export function useDocumentPrefs() {
  const [prefs] = usePrefs();
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = prefs.theme === 'system' ? (media?.matches ? 'light' : 'dark') : prefs.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      // Browser / installed-app title bar follows the theme (matches --bg).
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', theme === 'light' ? '#ffffff' : '#0b0b0b');
    };
    apply();
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [prefs.theme]);
}
