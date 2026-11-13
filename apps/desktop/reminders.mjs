// Calendar reminders while the app runs (also with the window closed / in the tray).
// Reads due alarms from the local API once a minute; each alarm is shown once.
export function createReminderMonitor({
  readAlarms,
  notify,
  intervalMs = 60_000,
  now = () => Date.now(),
  logger = () => {}
}) {
  const shown = new Map();
  let timer = null;
  let lastCheck = now() - intervalMs;
  async function check() {
    const current = now();
    // Overlapping window so that a slow tick never skips an alarm; duplicates are filtered.
    const from = new Date(Math.min(lastCheck, current - intervalMs) - 5_000).toISOString();
    const to = new Date(current + 1_000).toISOString();
    try {
      const { alarms = [] } = await readAlarms(from, to);
      for (const alarm of alarms) {
        if (shown.has(alarm.key) || alarm.at > current) continue;
        shown.set(alarm.key, current);
        notify(alarm);
      }
      lastCheck = current;
    } catch {
      logger('Reminders could not be read.');
    }
    for (const [key, at] of shown) if (current - at > 2 * 86_400_000) shown.delete(key);
  }
  return {
    start() {
      if (timer) return;
      void check();
      timer = setInterval(() => void check(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    check
  };
}
