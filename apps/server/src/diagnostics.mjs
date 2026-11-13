// Anonymous diagnostics: error codes and counters only – never addresses, subjects,
// message text, server names or credentials. Exported by the user on request.
import os from 'node:os';

export function createDiagnostics({ version, max = 200 }) {
  const events = [];
  const started = Date.now();
  return {
    record(area, code) {
      if (!/^[a-z0-9_.-]{1,40}$/i.test(String(area)) || !/^[a-z0-9_.-]{1,60}$/i.test(String(code))) return;
      events.push({ at: new Date().toISOString(), area, code });
      if (events.length > max) events.shift();
    },
    report(extra = {}) {
      const counts = {};
      for (const e of events) counts[`${e.area}:${e.code}`] = (counts[`${e.area}:${e.code}`] || 0) + 1;
      return {
        product: 'Levuvo Mail',
        version,
        createdAt: new Date().toISOString(),
        platform: `${process.platform} ${os.release()} ${process.arch}`,
        runtime: { node: process.versions.node, electron: process.versions.electron || null },
        uptimeMinutes: Math.round((Date.now() - started) / 60000),
        counts,
        recent: events.slice(-50),
        ...extra
      };
    }
  };
}
