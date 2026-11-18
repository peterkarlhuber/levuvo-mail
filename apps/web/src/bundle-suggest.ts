import type { Bundle, Message } from './types';

/**
 * Extension point for an optional second opinion on bundles (e.g. the AI assistant): a
 * suggester returns, per UID, a bundle (or null = keep in the inbox). Without one, or when it
 * fails, the local rules (server: bundles.mjs) apply unchanged.
 */
export type BundleSuggestion = { bundle: Bundle | null; reason?: string; source: 'ai' };
export type BundleSuggester = (messages: Message[], accountId: string) => Promise<Map<number, BundleSuggestion>>;
let suggester: BundleSuggester | null = null;
/** Registers (or with null removes) the single bundle suggester. */
export function registerBundleSuggester(fn: BundleSuggester | null) {
  suggester = fn;
}
export const bundleSuggester = () => suggester;

/** Messages with suggestions applied: `bundle` replaced, `bundleSource: 'ai'` marks it. */
export function applySuggestions(messages: Message[], suggestions: Map<number, BundleSuggestion>): Message[] {
  if (!suggestions.size) return messages;
  return messages.map(m => {
    const s = suggestions.get(m.uid);
    return s && s.bundle !== (m.bundle ?? null)
      ? { ...m, bundle: s.bundle, bundleSource: s.source, bundleReason: s.reason }
      : m;
  });
}
