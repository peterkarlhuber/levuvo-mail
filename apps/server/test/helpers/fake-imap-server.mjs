// Minimal scripted IMAP4rev1 server for tests (plaintext, node:net).
//
// It behaves like Dovecot does in practice: while it answers a FETCH or UID FETCH it can
// interleave UNSOLICITED untagged FETCH responses (flag updates for the same or other
// messages, with or without UID). ImapFlow passes every untagged FETCH that arrives while
// a command runs to the command result, so these lines reproduce "phantom" list entries.
//
// Interleaving is configured per server with `onFetch(info)`, which receives
// `{ uidMode, items, targets: [{ seq, uid }], count }` (count = 1-based number of the
// FETCH command on that connection) and returns `{ before, between, after }`: arrays of
// raw untagged lines (without CRLF) sent before the first, between each pair of and after
// the last real response line.
import net from 'node:net';

const CRLF = '\r\n';
const UID_VALIDITY = 1700000000;

function rfc822({ subject, fromName, fromAddr, date, messageId, body }) {
  return [
    `From: ${fromName} <${fromAddr}>`,
    'To: Test User <user@example.test>',
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
    ''
  ].join(CRLF);
}

/** Five simple text/plain messages with UIDs 10..14 (sequence numbers 1..5). */
export function defaultMessages() {
  return [10, 11, 12, 13, 14].map((uid, index) => {
    const n = index + 1;
    const meta = {
      subject: `Subject ${uid}`,
      fromName: `Sender ${uid}`,
      fromAddr: `sender${uid}@example.test`,
      date: `Mon, 0${n} Jun 2026 10:00:00 +0000`,
      messageId: `<msg-${uid}@example.test>`,
      body: `Body text of message ${uid}.${CRLF}Second line ${uid}.`
    };
    const source = Buffer.from(rfc822(meta), 'utf8');
    const bodyStart = source.indexOf(`${CRLF}${CRLF}`) + 4;
    return {
      uid,
      flags: n % 2 ? ['\\Seen'] : [],
      internalDate: `0${n}-Jun-2026 10:00:00 +0000`,
      ...meta,
      source,
      text: source.subarray(bodyStart)
    };
  });
}

const quote = value => `"${String(value).replace(/["\\]/g, m => `\\${m}`)}"`;
const address = (name, addr) => {
  const [mailbox, host] = addr.split('@');
  return `((${quote(name)} NIL ${quote(mailbox)} ${quote(host)}))`;
};

function envelope(msg) {
  const from = address(msg.fromName, msg.fromAddr);
  return `(${quote(msg.date)} ${quote(msg.subject)} ${from} ${from} ${from} ${address('Test User', 'user@example.test')} NIL NIL NIL ${quote(msg.messageId)})`;
}

function bodyStructure(msg) {
  const lines = msg.text.toString('latin1').split(CRLF).length - 1;
  return `("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" ${msg.text.length} ${lines} NIL NIL NIL NIL)`;
}

/** Expands an IMAP sequence set against a sorted list of numbers (`*` = highest). */
function expandSet(set, numbers) {
  const max = numbers.length ? numbers[numbers.length - 1] : 0;
  const value = part => (part === '*' ? max : Number(part));
  const out = new Set();
  for (const piece of String(set).split(',')) {
    const [a, b = a] = piece.split(':');
    const lo = Math.min(value(a), value(b));
    const hi = Math.max(value(a), value(b));
    for (const n of numbers) if (n >= lo && n <= hi) out.add(n);
    // RFC 3501: "n:*" always contains the highest number, even when n > max.
    if ((a === '*' || b === '*') && max) out.add(max);
  }
  return [...out].sort((x, y) => x - y);
}

function parseFetchItems(text) {
  const upper = text.toUpperCase();
  const items = {
    uid: /\bUID\b/.test(upper),
    flags: /\bFLAGS\b/.test(upper),
    envelope: /\bENVELOPE\b/.test(upper),
    internalDate: /\bINTERNALDATE\b/.test(upper),
    bodyStructure: /\bBODYSTRUCTURE\b/.test(upper),
    size: /\bRFC822\.SIZE\b/.test(upper),
    sections: []
  };
  for (const match of text.matchAll(/BODY(?:\.PEEK)?\[([^\]]*)\](?:<(\d+)(?:\.(\d+))?>)?/gi)) {
    items.sections.push({
      section: match[1].toUpperCase(),
      start: match[2] === undefined ? null : Number(match[2]),
      length: match[3] === undefined ? null : Number(match[3])
    });
  }
  return items;
}

/** Builds the bytes of one `* n FETCH (...)` response for a stored message. */
function fetchResponse(seq, msg, items) {
  const parts = [];
  if (items.uid) parts.push(`UID ${msg.uid}`);
  if (items.flags) parts.push(`FLAGS (${msg.flags.join(' ')})`);
  if (items.size) parts.push(`RFC822.SIZE ${msg.source.length}`);
  if (items.internalDate) parts.push(`INTERNALDATE ${quote(msg.internalDate)}`);
  if (items.envelope) parts.push(`ENVELOPE ${envelope(msg)}`);
  if (items.bodyStructure) parts.push(`BODYSTRUCTURE ${bodyStructure(msg)}`);
  const chunks = [];
  let head = `* ${seq} FETCH (${parts.join(' ')}`;
  for (const { section, start, length } of items.sections) {
    let data = section === '' ? msg.source : section === '1' || section === 'TEXT' ? msg.text : Buffer.alloc(0);
    if (start !== null) data = data.subarray(start, length === null ? undefined : start + length);
    head += `${parts.length || chunks.length ? ' ' : ''}BODY[${section}]${start !== null ? `<${start}>` : ''} {${data.length}}${CRLF}`;
    chunks.push(Buffer.from(head, 'latin1'), data);
    head = '';
  }
  chunks.push(Buffer.from(`${head})${CRLF}`, 'latin1'));
  return Buffer.concat(chunks);
}

/**
 * Starts the fake server on 127.0.0.1 with a random port.
 * Returns `{ port, commands, close() }`; `commands` records every client command line.
 */
export async function startFakeImapServer({ messages = defaultMessages(), onFetch = null } = {}) {
  const commands = [];
  const sockets = new Set();

  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    let selected = false;
    let fetchCount = 0;
    const write = text => {
      if (!socket.destroyed) socket.write(text);
    };
    const line = text => write(text + CRLF);
    const uids = () => messages.map(m => m.uid);
    const seqOf = msg => messages.indexOf(msg) + 1;

    const handleFetch = (tag, uidMode, set, itemText) => {
      fetchCount += 1;
      const items = parseFetchItems(itemText);
      // UID FETCH always returns the UID (RFC 3501 6.4.8).
      if (uidMode) items.uid = true;
      const targets = uidMode
        ? expandSet(set, uids()).map(uid => messages.find(m => m.uid === uid))
        : expandSet(
            set,
            messages.map((_, i) => i + 1)
          ).map(seq => messages[seq - 1]);
      const plan =
        onFetch?.({ uidMode, items, count: fetchCount, targets: targets.map(m => ({ seq: seqOf(m), uid: m.uid })) }) ||
        {};
      for (const extra of plan.before || []) line(extra);
      targets.forEach((msg, index) => {
        if (index > 0) for (const extra of plan.between || []) line(extra);
        write(fetchResponse(seqOf(msg), msg, items));
      });
      for (const extra of plan.after || []) line(extra);
      line(`${tag} OK ${uidMode ? 'UID ' : ''}FETCH completed`);
    };

    const handleSearch = (tag, uidMode, criteria) => {
      const upper = criteria.toUpperCase().trim();
      let found = messages.slice();
      const uidCrit = /(?:^|\s)UID\s+(\S+)/.exec(upper);
      if (uidCrit) {
        const allowed = new Set(expandSet(uidCrit[1], uids()));
        found = found.filter(m => allowed.has(m.uid));
      }
      if (/\bUNSEEN\b/.test(upper)) found = found.filter(m => !m.flags.includes('\\Seen'));
      if (/(?:^|\s)SEEN\b/.test(upper.replace(/UNSEEN/g, ''))) found = found.filter(m => m.flags.includes('\\Seen'));
      const ids = found.map(m => (uidMode ? m.uid : seqOf(m)));
      line(`* SEARCH${ids.length ? ' ' + ids.join(' ') : ''}`);
      line(`${tag} OK ${uidMode ? 'UID ' : ''}SEARCH completed`);
    };

    let idleTag = null;

    const handle = raw => {
      commands.push(raw);
      if (idleTag) {
        if (raw.toUpperCase() === 'DONE') line(`${idleTag} OK IDLE terminated`);
        idleTag = null;
        return;
      }
      const match = /^(\S+)\s+(\S+)(?:\s+(.*))?$/.exec(raw);
      if (!match) return line('* BAD invalid command');
      const [, tag, rawCommand, rest = ''] = match;
      const command = rawCommand.toUpperCase();
      const unselected = command === 'UID' ? !selected : false;
      if (unselected) return line(`${tag} BAD no mailbox selected`);
      switch (command) {
        case 'CAPABILITY':
          line('* CAPABILITY IMAP4rev1 IDLE UIDPLUS MOVE UNSELECT');
          return line(`${tag} OK CAPABILITY completed`);
        case 'LOGIN':
          return line(`${tag} OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS MOVE UNSELECT] Logged in`);
        case 'ID':
          line('* ID NIL');
          return line(`${tag} OK ID completed`);
        case 'NAMESPACE':
          line('* NAMESPACE (("" "/")) NIL NIL');
          return line(`${tag} OK NAMESPACE completed`);
        case 'LIST':
        case 'LSUB':
          // `LIST "" ""` asks for the hierarchy delimiter only.
          if (/^""\s+""$/.test(rest.trim())) line(`* ${command} (\\Noselect) "/" ""`);
          else line(`* ${command} (\\HasNoChildren) "/" INBOX`);
          return line(`${tag} OK ${command} completed`);
        case 'SELECT':
        case 'EXAMINE': {
          selected = true;
          const readOnly = command === 'EXAMINE';
          line('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)');
          line(
            `* OK [PERMANENTFLAGS (${readOnly ? '' : '\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*'})] Flags permitted`
          );
          line(`* ${messages.length} EXISTS`);
          line('* 0 RECENT');
          line(`* OK [UIDVALIDITY ${UID_VALIDITY}] UIDs valid`);
          line(`* OK [UIDNEXT ${Math.max(0, ...uids()) + 1}] Predicted next UID`);
          return line(`${tag} OK [${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] ${command} completed`);
        }
        case 'STATUS': {
          const unseen = messages.filter(m => !m.flags.includes('\\Seen')).length;
          line(
            `* STATUS INBOX (MESSAGES ${messages.length} UIDNEXT ${Math.max(0, ...uids()) + 1} UIDVALIDITY ${UID_VALIDITY} UNSEEN ${unseen})`
          );
          return line(`${tag} OK STATUS completed`);
        }
        case 'IDLE':
          idleTag = tag;
          return line('+ idling');
        case 'NOOP':
          return line(`${tag} OK NOOP completed`);
        case 'CLOSE':
        case 'UNSELECT':
          selected = false;
          return line(`${tag} OK ${command} completed`);
        case 'LOGOUT':
          line('* BYE Logging out');
          line(`${tag} OK LOGOUT completed`);
          return socket.end();
        case 'FETCH':
        case 'SEARCH': {
          if (!selected) return line(`${tag} BAD no mailbox selected`);
          if (command === 'SEARCH') return handleSearch(tag, false, rest);
          const fetch = /^(\S+)\s+(.*)$/.exec(rest);
          return fetch ? handleFetch(tag, false, fetch[1], fetch[2]) : line(`${tag} BAD syntax`);
        }
        case 'UID': {
          const sub = /^(\S+)\s+(.*)$/.exec(rest);
          const subCommand = sub?.[1].toUpperCase();
          if (subCommand === 'SEARCH') return handleSearch(tag, true, sub[2]);
          if (subCommand === 'FETCH') {
            const fetch = /^(\S+)\s+(.*)$/.exec(sub[2]);
            if (fetch) return handleFetch(tag, true, fetch[1], fetch[2]);
          }
          return line(`${tag} BAD unsupported UID command`);
        }
        default:
          return line(`${tag} BAD unsupported command`);
      }
    };

    socket.setEncoding('latin1');
    socket.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf(CRLF)) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (raw) handle(raw);
      }
    });
    socket.write(`* OK [CAPABILITY IMAP4rev1 IDLE UIDPLUS MOVE UNSELECT] Fake IMAP ready${CRLF}`);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    port: server.address().port,
    commands,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}
