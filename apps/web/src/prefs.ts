import { useCallback, useEffect, useState } from 'react';

// View preferences only. Never mail content, addresses or credentials.
export type Prefs = {
  density: 'comfortable' | 'compact';
  theme: 'system' | 'dark' | 'light';
  language: 'system' | 'de' | 'en';
  markReadOnOpen: boolean;
  conversations: boolean;
  listWidth: number;
  sendDelay: number;
  calendarView: 'month' | 'week' | 'day' | 'agenda';
  composeMode: 'html' | 'text';
};

const KEY = 'levuvo-mail-prefs-v2';
export const DEFAULT_PREFS: Prefs = {
  density: 'comfortable',
  theme: 'system',
  language: 'system',
  markReadOnOpen: true,
  conversations: false,
  listWidth: 400,
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
      listWidth:
        typeof v.listWidth === 'number' && v.listWidth >= 300 && v.listWidth <= 680
          ? v.listWidth
          : DEFAULT_PREFS.listWidth,
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

/** Applies theme and language to the document root. */
export function useDocumentPrefs() {
  const [prefs] = usePrefs();
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => {
      const theme = prefs.theme === 'system' ? (media?.matches ? 'light' : 'dark') : prefs.theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [prefs.theme]);
}
