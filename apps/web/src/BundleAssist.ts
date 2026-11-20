import { useEffect } from 'react';
import { aiEnabled, aiLocal, runAi } from './ai';
import { bundleFromClassification } from './ai-utils';
import { createClassifyCache } from './bundle-cache';
import { registerBundleSuggester, type BundleSuggestion } from './bundle-suggest';
import { useT } from './i18n';
import type { Message } from './types';

const BATCH = 60; // the server takes at most 60 messages per classify call
const MAX_CACHE = 5000;

/**
 * Plugs the assistant's `classify` function into the inbox bundles; does nothing while the
 * assistant or its "Bündel & Screening" function is off (checked on every call).
 * Only messages not seen before are sent (subject, sender and preview), and only to a local model;
 * with a cloud provider the local rules stay. Errors leave the local rules in place.
 */
export function useBundleAssist() {
  const { t, lang } = useT();
  useEffect(() => {
    const cache = createClassifyCache<BundleSuggestion>({ max: MAX_CACHE });
    const running = new Set<string>();
    const reason = t('Vom Assistenten einsortiert');
    registerBundleSuggester(async (messages: Message[], accountId: string) => {
      // Background sorting sends sender, subject and preview of every new message: only with a
      // local model (a cloud provider is used only for what the user starts).
      if (!(await aiEnabled('classify')) || !(await aiLocal())) return new Map();
      const fresh = messages.filter(m => !cache.known(accountId, m)).slice(0, BATCH);
      if (fresh.length && !running.has(accountId) && cache.ready(accountId)) {
        running.add(accountId);
        try {
          const res = await runAi<{ items: { id: string; bundle: string; from_person: boolean }[] }>('classify', {
            account: accountId,
            lang,
            background: true,
            input: {
              messages: fresh.map(m => ({
                id: String(m.uid),
                from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
                subject: m.subject,
                preview: m.preview || ''
              }))
            }
          });
          const results = new Map<number, BundleSuggestion>();
          for (const [uid, bundle] of bundleFromClassification(res.result?.items || []))
            results.set(uid, { bundle, reason, source: 'ai' });
          // Messages the model skipped are remembered too: they are not sent again.
          cache.settle(accountId, fresh, results);
        } catch {
          cache.fail(accountId); // local rules stay; retried after a growing pause
        } finally {
          running.delete(accountId);
        }
      }
      const found = new Map<number, BundleSuggestion>();
      for (const m of messages) {
        const s = cache.get(accountId, m);
        if (s) found.set(m.uid, s);
      }
      return found;
    });
    return () => {
      registerBundleSuggester(null);
    };
  }, [t, lang]);
}
