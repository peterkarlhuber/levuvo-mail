// In-memory mail store shared by several fake ImapFlow clients ("devices"). Every client
// call is one atomic server operation, like a real IMAP server; `gate(op, client)` lets a
// test pause a client before an operation to force a specific interleaving.

const tick = () => new Promise(resolve => setImmediate(resolve));

function headerOf(source, name) {
  const head = source.toString('latin1').split(/\r?\n\r?\n/, 1)[0];
  const re = new RegExp(`(?:^|\\n)${name}:[ \\t]*([^\\r\\n]*)`, 'i');
  return re.exec(head)?.[1]?.trim() ?? null;
}

export function createMailStore({ folders = ['INBOX', 'Drafts', 'Sent', 'Trash'], permanentFlags = null } = {}) {
  const boxes = new Map(
    folders.map(path => [path, { path, uidValidity: 7, nextUid: 1, messages: new Map(), modseq: 1n }])
  );
  const specialUse = { Drafts: '\\Drafts', Sent: '\\Sent', Trash: '\\Trash' };

  function add(path, source, flags = [], options = {}) {
    const box = boxes.get(path);
    const uid = box.nextUid++;
    box.modseq++;
    box.messages.set(uid, {
      uid,
      source: Buffer.from(source),
      flags: new Set(flags),
      internalDate: options.internalDate || new Date('2026-11-18T10:00:00Z'),
      modseq: box.modseq
    });
    return uid;
  }

  function client({
    name = 'client',
    gate = async () => {},
    failAppend = null,
    capabilities = ['MOVE', 'UIDPLUS']
  } = {}) {
    let selected = null;
    const box = () => boxes.get(selected);
    const op = async kind => {
      await gate(kind, name);
      await tick();
    };
    const range = (spec, uidMode = true) => {
      const all = [...box().messages.keys()].sort((a, b) => a - b);
      if (Array.isArray(spec)) return spec.map(Number).filter(u => box().messages.has(u));
      const text = String(spec);
      if (text === '1:*') return all;
      if (!uidMode) return all;
      return text
        .split(',')
        .map(Number)
        .filter(u => box().messages.has(u));
    };
    const envelope = m => ({
      subject: headerOf(m.source, 'subject') || '',
      messageId: headerOf(m.source, 'message-id'),
      from: [{ address: (headerOf(m.source, 'from') || '').replace(/.*<|>.*/g, '') }],
      to: (headerOf(m.source, 'to') || '')
        .split(',')
        .filter(Boolean)
        .map(a => ({ address: a.trim().replace(/.*<|>.*/g, '') }))
    });
    const api = {
      name,
      capabilities: new Set(capabilities),
      enabled: new Set(),
      get mailbox() {
        const b = box();
        return b
          ? {
              path: b.path,
              uidValidity: b.uidValidity,
              exists: b.messages.size,
              permanentFlags: permanentFlags ? new Set(permanentFlags) : new Set(['\\*'])
            }
          : false;
      },
      async list() {
        await op('list');
        return [...boxes.keys()].map(path => ({
          path,
          delimiter: '/',
          flags: new Set(),
          specialUse: specialUse[path]
        }));
      },
      async getMailboxLock(path) {
        await op('lock');
        if (!boxes.has(path)) throw Object.assign(new Error('no mailbox'), { responseStatus: 'NO' });
        selected = path;
        return { release() {} };
      },
      async mailboxCreate(path) {
        boxes.set(path, { path, uidValidity: 9, nextUid: 1, messages: new Map(), modseq: 1n });
        return { path };
      },
      async search(query) {
        await op('search');
        const list = [...box().messages.values()];
        const header = query?.header || {};
        const uidRange = typeof query?.uid === 'string' ? /^(\d+):(\*|\d+)$/.exec(query.uid) : null;
        return list
          .filter(
            m => !uidRange || (m.uid >= Number(uidRange[1]) && (uidRange[2] === '*' || m.uid <= Number(uidRange[2])))
          )
          .filter(m => !query?.before || m.internalDate < query.before)
          .filter(m =>
            Object.entries(header).every(([key, value]) => {
              const v = headerOf(m.source, key);
              return v !== null && v.toLowerCase().includes(String(value).toLowerCase());
            })
          )
          .map(m => m.uid);
      },
      async *fetch(spec, query) {
        await op('fetch');
        for (const uid of range(spec)) {
          const m = box().messages.get(uid);
          if (!m) continue;
          const out = { uid, seq: uid };
          if (query.flags) out.flags = new Set(m.flags);
          if (query.source) out.source = Buffer.from(m.source);
          if (query.envelope) out.envelope = envelope(m);
          if (query.internalDate) out.internalDate = m.internalDate;
          if (query.size) out.size = m.source.length;
          if (query.headers) {
            const lines = query.headers
              .map(h => [h, headerOf(m.source, h)])
              .filter(([, v]) => v !== null)
              .map(([h, v]) => `${h}: ${v}`);
            out.headers = Buffer.from(lines.join('\r\n') + '\r\n');
          }
          yield out;
        }
      },
      async status(path) {
        await op('status');
        const b = boxes.get(path);
        return { path, uidNext: b.nextUid, uidValidity: b.uidValidity, messages: b.messages.size };
      },
      async messageDelete(spec) {
        await op('delete');
        for (const uid of range(spec)) box().messages.delete(uid);
        return true;
      },
      async messageFlagsAdd(spec, flags) {
        await op('store');
        for (const uid of range(spec)) for (const f of flags) box().messages.get(uid).flags.add(f);
        return true;
      },
      async messageFlagsRemove(spec, flags) {
        await op('store');
        for (const uid of range(spec)) for (const f of flags) box().messages.get(uid).flags.delete(f);
        return true;
      },
      async messageMove(spec, target, { noUidMap = false } = {}) {
        await op('move');
        const uids = range(spec);
        if (!uids.length) return { path: selected, uidValidity: boxes.get(target).uidValidity };
        const uidMap = new Map();
        for (const uid of uids) {
          const m = box().messages.get(uid);
          box().messages.delete(uid);
          uidMap.set(uid, add(target, m.source, [...m.flags]));
        }
        return {
          path: selected,
          destination: target,
          uidValidity: boxes.get(target).uidValidity,
          ...(noUidMap || !api.capabilities.has('UIDPLUS') ? {} : { uidMap })
        };
      },
      async append(path, source, flags) {
        await op('append');
        const mode = failAppend?.(flags);
        if (mode === 'refuse') throw Object.assign(new Error('NO [CANNOT] keyword'), { responseStatus: 'NO' });
        if (mode === 'before') throw Object.assign(new Error('Connection lost'), { code: 'NoConnection' });
        const uid = add(path, source, flags);
        if (mode === 'after') throw Object.assign(new Error('Socket timeout'), { code: 'ETIMEOUT' });
        return { destination: path, uid, uidValidity: boxes.get(path).uidValidity };
      }
    };
    return api;
  }

  return {
    client,
    add,
    box: path => boxes.get(path),
    messages: path => [...boxes.get(path).messages.values()],
    flagsOf: (path, uid) => boxes.get(path).messages.get(uid)?.flags
  };
}
