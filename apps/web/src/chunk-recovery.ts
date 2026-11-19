// Recovery when a lazily loaded part of the UI (a module chunk) cannot be fetched.
// Typical cause: the app was updated or reinstalled while its window stayed open (closing the
// window only hides it), so the running page still asks for chunk names of the old build.
// One reload fetches the current index.html with the current chunk names. A second failure
// within a minute is passed on to the error boundary instead of reloading in a loop.
// Pure logic without imports (unit-tested in apps/web/test).

export const CHUNK_RELOAD_KEY = 'levuvo-chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

/** True for the errors browsers throw when a dynamic import() fails to load. */
export function isChunkLoadError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'ChunkLoadError') return true;
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS/i.test(
    String(message || '')
  );
}

export type RecoveryEnv = {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  reload: () => void;
  now: () => number;
};

/**
 * Runs `factory`; on a chunk load error reloads the page once per minute. While the reload is
 * under way the returned promise never settles, so React keeps showing the loading state
 * instead of an error.
 */
export async function loadWithRecovery<T>(factory: () => Promise<T>, env: RecoveryEnv): Promise<T> {
  try {
    return await factory();
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;
    const last = Number(env.read(CHUNK_RELOAD_KEY) || 0);
    const now = env.now();
    if (Number.isFinite(last) && now - last >= 0 && now - last < RELOAD_WINDOW_MS) throw error;
    env.write(CHUNK_RELOAD_KEY, String(now));
    env.reload();
    return new Promise<T>(() => {});
  }
}

/** The browser environment (session storage may be blocked: then no reload is attempted twice). */
export function browserRecoveryEnv(): RecoveryEnv {
  let memory: string | null = null;
  return {
    read: key => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return memory;
      }
    },
    write: (key, value) => {
      memory = value;
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        /* storage blocked: the in-memory value still stops a loop within this page */
      }
    },
    reload: () => window.location.reload(),
    now: () => Date.now()
  };
}
