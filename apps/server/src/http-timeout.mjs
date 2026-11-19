// Every request to an outside service gets a deadline: a hanging token endpoint, Graph, Google or
// CalDAV server must not hold the scheduler, the watcher or a sync run for minutes.
export const TIMEOUTS = { token: 15_000, api: 60_000, dav: 30_000 };

/** fetch with AbortSignal.timeout(ms), unless the caller brings its own signal. */
export function withTimeout(fetchImpl, ms) {
  return (url, init = {}) => fetchImpl(url, init?.signal ? init : { ...init, signal: AbortSignal.timeout(ms) });
}
