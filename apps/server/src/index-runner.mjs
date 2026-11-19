import { indexableFolders } from './local-index.mjs';

/** Pause between two catch-up batches while a mailbox is still being indexed for the first time. */
export const INDEX_CATCH_UP_MS = 20_000;

/**
 * Background indexing of all accounts. A regular pass indexes `budget` messages per account; while
 * an account is not complete yet (first build of a large mailbox), the next batch follows after
 * `catchUpMs` instead of waiting for the next regular pass 15 minutes later.
 */
export function createIndexRunner({
  accounts,
  enabled,
  withImap,
  localIndex,
  diagnostics,
  catchUpMs = INDEX_CATCH_UP_MS,
  timers = { setTimeout, clearTimeout }
}) {
  let running = false;
  let active = false;
  let catchUp = null;

  async function run(force = false) {
    if (running || !enabled()) return { ran: false, incomplete: false };
    running = true;
    let incomplete = false;
    try {
      for (const account of accounts().filter(a => a.imap.configured)) {
        try {
          const result = await withImap(
            async client =>
              localIndex.sync(client, account.id, indexableFolders(await client.list()), {
                budget: force ? 5000 : 1500
              }),
            account
          );
          if (result?.enabled && result.complete === false) incomplete = true;
        } catch {
          diagnostics.record('index', 'sync_failed');
        }
      }
    } finally {
      running = false;
    }
    if (incomplete && active && !catchUp) {
      catchUp = timers.setTimeout(() => {
        catchUp = null;
        void run();
      }, catchUpMs);
      catchUp?.unref?.();
    }
    return { ran: true, incomplete };
  }

  return {
    run,
    /** Catch-up batches only run between start() and stop(), i.e. while background jobs run. */
    start() {
      active = true;
    },
    stop() {
      active = false;
      if (catchUp) timers.clearTimeout(catchUp);
      catchUp = null;
    }
  };
}
