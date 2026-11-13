import { useCallback } from 'react';
import { usePrefs } from './prefs';
import { EN } from './i18n-en';

// German is the source language: t('Neue Nachricht') returns the German text or its
// English translation. Placeholders: t('{count} Nachrichten', { count: 3 }).
// Server messages (German) are translated with the same dictionary where available.

export type Lang = 'de' | 'en';
type Vars = Record<string, string | number>;

export function resolveLang(pref: string): Lang {
  if (pref === 'de' || pref === 'en') return pref;
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function translate(lang: Lang, text: string, vars?: Vars) {
  const source = lang === 'en' ? (EN[text] ?? text) : text;
  return vars ? source.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : source;
}

export function useT() {
  const [prefs] = usePrefs();
  const lang = resolveLang(prefs.language);
  const t = useCallback((text: string, vars?: Vars) => translate(lang, text, vars), [lang]);
  return { t, lang, locale: lang === 'de' ? 'de-AT' : 'en-GB' };
}
