import { useEffect } from 'react';
import { aiEnabled, runAi } from './ai';
import { bundleFromClassification } from './ai-utils';
import { registerBundleSuggester, type BundleSuggestion } from './bundle-suggest';
import { useT } from './i18n';
import type { Message } from './types';

const BATCH = 60; // the server takes at most 60 messages per classify call
const MAX_CACHE = 5000;

/**
 * Plugs the assistant's `classify` function into the inbox bundles; does nothing while the
 * assistant or its "Bündel & Screening" function is off (checked on every call).
 * Only messages not seen before are sent (subject, sender and preview; the server applies the
 * per-account "No cloud AI" block). Errors leave the local rules in place.
 */
export function useBundleAssist() {
  const { t, lang } = useT();
  useEffect(() => {
    const cache = new Map<string, BundleSuggestion>();
    const running = new Set<string>();
    const reason = t('Vom Assistenten einsortiert');
    registerBundleSuggester(async (messages: Message[], accountId: string) => {
      if (!(await aiEnabled('classify'))) return new Map();
      const key = (uid: number) => `${accountId}:${uid}`;
      const fresh = messages.filter(m => !cache.has(key(m.uid))).slice(0, BATCH);
      if (fresh.length && !running.has(accountId)) {
        running.add(accountId);
        try {
          const res = await runAi<{ items: { id: string; bundle: string; from_person: boolean }[] }>('classify', {
            account: accountId,
            lang,
            input: {
              messages: fresh.map(m => ({
                id: String(m.uid),
                from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
                subject: m.subject,
                preview: m.preview || ''
              }))
            }
          });
          for (const [uid, bundle] of bundleFromClassification(res.result?.items || []))
            cache.set(key(uid), { bundle, reason, source: 'ai' });
          if (cache.size > MAX_CACHE) cache.clear();
        } finally {
          running.delete(accountId);
        }
      }
      const found = new Map<number, BundleSuggestion>();
      for (const m of messages) {
        const s = cache.get(key(m.uid));
        if (s) found.set(m.uid, s);
      }
      return found;
    });
    return () => {
      registerBundleSuggester(null);
    };
  }, [t, lang]);
}
