// Sources under an answer of the assistant.

type SourceKey = {
  subject?: string;
  fromEmail?: string;
  fromName?: string;
  date?: string;
  // manual sections
  chapterId?: string;
  section?: string;
};

/**
 * One chip per mail: the same mail can be found twice (e.g. in two folders), and identical
 * notifications (same subject, sender and day) would only repeat the same link.
 */
export function uniqueSources<T extends SourceKey>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter(s => {
    const key = [
      s.chapterId || '',
      s.section || '',
      s.subject || '',
      s.fromEmail || s.fromName || '',
      String(s.date || '').slice(0, 10)
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
