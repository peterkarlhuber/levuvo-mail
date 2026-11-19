// Windowing for long lists with rows of different heights (message list).
// Only the rows near the visible area are in the DOM; measured heights replace the estimate.
// Pure functions so they can be tested without a browser (apps/web/test/web.test.mjs).

/** Start offset of every row plus the total height at the end (length = count + 1). */
export function rowOffsets(keys: readonly string[], measured: ReadonlyMap<string, number>, estimate: number) {
  const offsets = new Float64Array(keys.length + 1);
  for (let i = 0; i < keys.length; i++) offsets[i + 1] = offsets[i] + (measured.get(keys[i]) ?? estimate);
  return offsets;
}

/** Index of the row that contains position y (binary search). */
export function rowAt(offsets: Float64Array, y: number) {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Rows [start, end) to render for the scroll position, with `overscan` rows before and after. */
export function visibleRange(offsets: Float64Array, scrollTop: number, viewport: number, overscan: number) {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const first = rowAt(offsets, Math.max(0, scrollTop));
  const last = rowAt(offsets, Math.max(0, scrollTop + Math.max(viewport, 1) - 1));
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) };
}

/** Sorted indices to render: the window plus pinned rows (focused, selected) outside of it. */
export function renderIndices(range: { start: number; end: number }, pinned: readonly number[], count: number) {
  const out: number[] = [];
  for (let i = range.start; i < range.end; i++) out.push(i);
  const extra = pinned.filter(i => i >= 0 && i < count && (i < range.start || i >= range.end));
  if (!extra.length) return out;
  return Array.from(new Set([...out, ...extra])).sort((a, b) => a - b);
}

/** New scrollTop that shows row `index` completely (“nearest”), or null if it is already visible. */
export function scrollToShow(offsets: Float64Array, index: number, scrollTop: number, viewport: number) {
  if (index < 0 || index >= offsets.length - 1) return null;
  const top = offsets[index];
  const bottom = offsets[index + 1];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return Math.max(0, Math.min(top, bottom - viewport));
  return null;
}

/** Target row for list keyboard navigation (arrows, Home/End, Page keys). */
export function navigateIndex(key: string, index: number, count: number, page: number) {
  if (count <= 0) return -1;
  const step = Math.max(1, page);
  const at = index < 0 ? 0 : index;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'PageDown':
      return Math.min(count - 1, at + step);
    case 'PageUp':
      return Math.max(0, at - step);
    default:
      return -1;
  }
}
