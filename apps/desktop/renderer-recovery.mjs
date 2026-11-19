// When the window's renderer process dies (crash, out of memory, killed by the OS), Electron
// leaves the window empty: only its background colour shows, a black window in dark mode.
// The page is reloaded instead, at most `limit` times within `windowMs`, so a page that crashes
// right after loading does not reload in an endless loop.

/** Reasons for which reloading makes sense ('clean-exit' is a normal end, e.g. on quit). */
const RECOVERABLE = new Set(['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure']);

export function createRendererRecovery({ limit = 3, windowMs = 60_000, now = () => Date.now() } = {}) {
  let recent = [];
  return {
    /** True when the page should be reloaded after the renderer ended with `reason`. */
    shouldReload(reason) {
      if (!RECOVERABLE.has(String(reason || ''))) return false;
      const t = now();
      recent = recent.filter(at => t - at < windowMs);
      if (recent.length >= limit) return false;
      recent.push(t);
      return true;
    }
  };
}
