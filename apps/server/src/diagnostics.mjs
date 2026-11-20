// Anonymous diagnostics: error codes and counters only – never addresses, subjects,
// message text, server names or credentials. Exported by the user on request.
import os from 'node:os';

/**
 * Anonymous class of an unexpected error: its system code (ENOSPC, EACCES …) or its type
 * (TypeError …). Never the message, which can contain paths, addresses or server answers.
 */
export function errorKind(err) {
  if (!err || typeof err !== 'object') return null;
  const code = typeof err.code === 'string' ? err.code : '';
  if (/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return code;
  const name = typeof err.name === 'string' ? err.name : '';
  return /^[A-Za-z][A-Za-z0-9]{1,39}$/.test(name) ? name : 'Error';
}

export function createDiagnostics({ version, max = 200 }) {
  const events = [];
  const started = Date.now();
  return {
    record(area, code, err = null) {
      if (!/^[a-z0-9_.-]{1,40}$/i.test(String(area)) || !/^[a-z0-9_.-]{1,60}$/i.test(String(code))) return;
      const kind = errorKind(err);
      events.push(
        kind ? { at: new Date().toISOString(), area, code, kind } : { at: new Date().toISOString(), area, code }
      );
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
