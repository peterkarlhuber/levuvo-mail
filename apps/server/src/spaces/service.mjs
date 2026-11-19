// Shared spaces: create, invite by mail, join, edit together, sync over the members' own mail
// accounts. No server of our own: changes travel as end-to-end encrypted mails between members,
// every member keeps a full encrypted copy, and a removed member loses access to new content
// because the space key is replaced.
import * as Y from 'yjs';
import {
  b64u,
  canonical,
  identityKeys,
  memberIdOf,
  newSymmetricKey,
  open,
  randomId,
  safetyCode,
  seal,
  sha256,
  signatureValid,
  signed,
  unb64u,
  wrapKey
} from './crypto.mjs';
import {
  appendTextUpdate,
  applyOp,
  CHAT_TYPES,
  compareOps,
  fold,
  noteText,
  OP_TYPES,
  purgeState,
  validCard,
  validateOpData
} from './model.mjs';

export const CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_FILE_SIZE = 250 * 1024 * 1024;
const MAX_ENVELOPE_OPS_BYTES = 4 * 1024 * 1024;
const INVITE_DAYS = 14;
const AUTO_FETCH_LIMIT = 25 * 1024 * 1024;
const NEED_PAUSE = 60 * 60_000;
// Checkpoints (owner): after something was deleted, at most every COMPACT_PAUSE, and whenever the
// log has COMPACT_OPS operations past the last checkpoint.
const COMPACT_PAUSE = 30_000;
const COMPACT_OPS = 500;
const CHECKPOINT_PART = 4 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 200 * 1024 * 1024;
const DELETE_TYPES = new Set([
  'note.delete',
  'mail.remove',
  'comment.delete',
  'task.delete',
  'event.delete',
  'file.delete',
  'chat.delete'
]);
// Chat changes skip the batch pause and go out right away (one mail per member).
const URGENT_TYPES = new Set(CHAT_TYPES);
const MAX_UNREAD = 2000;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const SPACE_ID = /^[a-f0-9]{32}$/;
const now = () => new Date().toISOString();

/**
 * @param {object} o
 * @param {Awaited<ReturnType<import('./store.mjs').openSpaceStore>>} o.store
 * @param {{ send(msg: {accountId:string, from:string, to:string, kind:string, spaceName:string, inviterName?:string, envelope:object}): Promise<void> }} o.transport
 * @param {() => {id:string,address:string,name:string,addresses:string[]}[]} o.accounts  own sending identities
 */
export function createSpaceService({
  store,
  transport,
  accounts,
  logger = () => {},
  clock = now,
  batchDelay = 0,
  compactPause = COMPACT_PAUSE
}) {
  const keys = identityKeys(store.identity);
  const cache = new Map(); // space id → { state, docs, ids:Set, last }
  const listeners = new Set();
  // Change counter per space (and one for the list), for clients that wait for the next change.
  const revs = new Map();
  const waiters = new Set();
  const changed = id => {
    revs.set(id, (revs.get(id) || 0) + 1);
    for (const w of [...waiters]) if (w.id === id || w.id === undefined) w.done();
    for (const fn of listeners) {
      try {
        fn(id);
      } catch {}
    }
  };

  const accountFor = (accountId, email) => {
    const all = accounts();
    const account =
      all.find(a => a.id === accountId) || all.find(a => a.addresses.includes(String(email || '').toLowerCase()));
    if (!account) throw fail('Das Konto für diesen Raum ist nicht mehr eingerichtet.', 'spaces_account_missing', 409);
    return account;
  };
  const myCard = (email, name) => ({
    id: keys.id,
    email: email.toLowerCase(),
    name: name || '',
    signPub: keys.signPub,
    boxPub: keys.boxPub
  });

  // ---------------------------------------------------------------- state cache
  function view(record) {
    let entry = cache.get(record.id);
    if (!entry || entry.count !== record.ops.length) {
      const { state, docs } = fold(record.id, record.ops, record.base);
      entry = {
        state,
        docs,
        count: record.ops.length,
        ids: new Set(record.ops.map(o => o.id)),
        last: [...record.ops].sort(compareOps).at(-1)
      };
      cache.set(record.id, entry);
    }
    return entry;
  }
  /** Adds verified ops; folds incrementally when they sort after everything known. */
  function addOps(record, ops) {
    const entry = view(record);
    const fresh = ops.filter(op => !entry.ids.has(op.id));
    if (!fresh.length) return 0;
    fresh.sort(compareOps);
    record.ops.push(...fresh);
    for (const op of fresh) {
      entry.ids.add(op.id);
      record.lc = Math.max(record.lc || 0, op.lc);
      // Chat messages of others are unread on this device until the chat was shown.
      if (op.type === 'chat.post' && op.author !== keys.id && typeof op.data?.id === 'string') {
        record.chatUnread = [...(record.chatUnread || []), op.data.id].slice(-MAX_UNREAD);
      }
      // Deleted content leaves every log with the next checkpoint (made by the owner).
      if (DELETE_TYPES.has(op.type)) record.compactAsked = true;
    }
    if (!entry.last || compareOps(fresh[0], entry.last) > 0) {
      for (const op of fresh) applyOp(entry.state, op, entry.docs);
      entry.last = fresh.at(-1);
      entry.count = record.ops.length;
    } else {
      cache.delete(record.id);
    }
    return fresh.length;
  }
  const stateOf = record => view(record).state;

  const record = id => {
    if (!SPACE_ID.test(String(id || ''))) throw fail('Raum nicht gefunden.', 'spaces_missing', 404);
    const r = store.get(id);
    if (!r) throw fail('Raum nicht gefunden.', 'spaces_missing', 404);
    return r;
  };
  const epochKey = (r, epoch = r.epoch) => {
    const k = r.keys?.[epoch];
    return k ? unb64u(k) : null;
  };

  /** Version vector: highest contiguous sequence number held per author (checkpoint included). */
  function versionVector(r) {
    const seqs = new Map();
    for (const op of r.ops) {
      if (!seqs.has(op.author)) seqs.set(op.author, new Set());
      seqs.get(op.author).add(op.seq);
    }
    const vv = { ...(r.base?.header.vv || {}) };
    for (const [author, set] of seqs) {
      let n = vv[author] || 0;
      while (set.has(n + 1)) n++;
      vv[author] = n;
    }
    return vv;
  }
  /** Ops already contained in the checkpoint: never stored or applied again. */
  const covered = (r, op) => op.seq <= (r.base?.header.vv[op.author] || 0);

  // ---------------------------------------------------------------- envelopes
  function sealedEnvelope(r, inner, epoch = r.epoch) {
    const box = seal(epochKey(r, epoch), JSON.stringify(inner), `space.${r.id}.${epoch}`);
    return signed(keys, { v: 1, t: 'sealed', space: r.id, from: keys.id, epoch, box });
  }
  function boxedEnvelope(spaceId, recipient, inner, { card } = {}) {
    const k = newSymmetricKey();
    const wrap = wrapKey(k, recipient.boxPub, spaceId);
    const box = seal(k, JSON.stringify(inner), `boxed.${spaceId}.${recipient.id}`);
    return signed(keys, {
      v: 1,
      t: 'boxed',
      space: spaceId,
      from: keys.id,
      to: recipient.id,
      wrap,
      box,
      ...(card ? { card } : {})
    });
  }

  function recipientsOf(r, { include = [] } = {}) {
    const state = stateOf(r);
    const list = Object.values(state.members).filter(m => m.id !== keys.id && (!m.removed || include.includes(m.id)));
    return list;
  }
  function enqueue(r, to, item) {
    r.outbox ||= [];
    // The key epoch is fixed when queued: a member removed meanwhile still gets the removal
    // notice under the key they have, and never content under the new one.
    r.outbox.push({ id: randomId(8), to: to.id, email: to.email, tries: 0, nextAt: 0, epoch: r.epoch, ...item });
  }
  /**
   * Asks a member for the ops we lack. At most one open request per member, and the same
   * request (same version vector) not again within NEED_PAUSE: a gap that an answer does not
   * close must not turn into an endless need/ops exchange.
   */
  function askFor(r, member, vv) {
    const key = JSON.stringify(vv);
    if ((r.outbox || []).some(i => i.kind === 'need' && i.to === member.id && i.vv)) return;
    r.asked ||= {};
    const last = r.asked[member.id];
    if (last && last.key === key && Date.now() - last.at < NEED_PAUSE) return;
    r.asked[member.id] = { key, at: Date.now() };
    enqueue(r, member, { kind: 'need', vv });
  }
  /** Queues ops for every other active member, split into envelopes of reasonable size. */
  function broadcastOps(r, ops, { include = [], urgent = false } = {}) {
    if (!ops.length) return;
    for (const member of recipientsOf(r, { include }))
      sendOps(
        r,
        member,
        ops.map(o => o.id),
        { urgent }
      );
  }
  /**
   * Queues ops for one member. They join an ops mail to that member that is still waiting (same
   * key epoch, not being sent, never failed), so many small changes travel as one mail.
   */
  function sendOps(r, member, ids, { urgent = false } = {}) {
    const waiting = (r.outbox || []).find(
      i => i.kind === 'ops' && i.to === member.id && i.epoch === r.epoch && !i.tries && !i.sending
    );
    if (waiting) {
      waiting.ops = [...new Set([...waiting.ops, ...ids])];
      if (urgent) waiting.urgent = true;
    } else enqueue(r, member, { kind: 'ops', ops: ids, ...(urgent ? { urgent: true } : {}) });
  }

  function opsBatches(r, ids) {
    // Ops moved into a checkpoint stay in `held` until every mail that names them has gone out.
    const byId = new Map([...Object.entries(r.held || {}), ...r.ops.map(o => [o.id, o])]);
    const ops = ids.map(id => byId.get(id)).filter(Boolean);
    const batches = [];
    let current = [];
    let size = 0;
    for (const op of ops) {
      const len = JSON.stringify(op).length;
      if (current.length && size + len > MAX_ENVELOPE_OPS_BYTES) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push(op);
      size += len;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  async function buildEnvelopes(r, item) {
    switch (item.kind) {
      case 'invite':
        return [item.envelope];
      case 'ops':
        return opsBatches(r, item.ops).map(ops =>
          sealedEnvelope(r, { t: 'ops', ops, vv: versionVector(r) }, item.epoch || r.epoch)
        );
      case 'keys':
      case 'join': {
        return [item.envelope];
      }
      case 'need':
        return [sealedEnvelope(r, { t: 'need', vv: item.vv || null, blobs: item.blobs || [] })];
      case 'checkpoint': {
        if (!r.base) return [];
        const { header } = r.base;
        if (!item.full) return [sealedEnvelope(r, { t: 'checkpoint', header })];
        const body = JSON.stringify({ state: r.base.state, notes: r.base.notes });
        const parts = Math.max(1, Math.ceil(body.length / CHECKPOINT_PART));
        return Array.from({ length: parts }, (_, n) =>
          sealedEnvelope(r, {
            t: 'checkpoint',
            header,
            part: n,
            parts,
            data: body.slice(n * CHECKPOINT_PART, (n + 1) * CHECKPOINT_PART)
          })
        );
      }
      case 'blob': {
        const data = await store.getChunk(item.blob, item.n);
        if (!data) return [];
        return [sealedEnvelope(r, { t: 'blob', blob: item.blob, n: item.n, data: data.toString('base64') })];
      }
      default:
        return [];
    }
  }

  let flushing = null;
  let flushAgain = false;
  /** One pass over every outbox. Items queued meanwhile stay queued for the next pass. */
  async function flushPass() {
    let sent = 0;
    for (const r of store.all()) {
      if (compactDue(r)) {
        await compact(r).catch(err => logger(`spaces: checkpoint failed: ${err.message}`));
        await store.save(r);
      }
      if (!r.outbox?.length) continue;
      let account;
      try {
        account = accountFor(r.accountId, r.email);
      } catch {
        continue;
      }
      // The items stay in the outbox while they are sent and leave it one by one after success,
      // so a save by another operation meanwhile (or a crash) never loses a pending sync mail.
      // Items queued while this pass runs stay for the next pass.
      for (const item of r.outbox) delete item.sending;
      const items = [...r.outbox];
      const state = stateOf(r);
      for (const item of items) {
        if (item.nextAt > Date.now()) continue;
        // Nothing joins a mail while it is being sent.
        item.sending = true;
        try {
          for (const envelope of await buildEnvelopes(r, item)) {
            await transport.send({
              accountId: account.id,
              from: r.email,
              to: item.email,
              kind: item.kind,
              spaceName: state.name || r.name || '',
              inviterName: r.myName || account.name || '',
              // A hint for transports: chat wants the fastest way (a relay could use it later).
              urgent: Boolean(item.urgent),
              envelope
            });
            sent++;
          }
          r.outbox = r.outbox.filter(i => i !== item);
        } catch (err) {
          delete item.sending;
          item.tries++;
          item.error = String(err.code || err.message || 'send_failed').slice(0, 100);
          item.nextAt = Date.now() + Math.min(6 * 3600_000, 30_000 * 2 ** Math.min(item.tries, 10));
          if (item.tries >= 30) {
            r.outbox = r.outbox.filter(i => i !== item);
            logger(`spaces: giving up on a ${item.kind} mail after ${item.tries} attempts`);
          }
        }
      }
      releaseHeld(r);
      await store.save(r);
    }
    return sent;
  }
  /**
   * Sends soon: changes made within `batchDelay` travel together (one mail per member instead of
   * one per change). Without a delay, right away.
   */
  let soonTimer = null;
  function soon() {
    if (!batchDelay) return void flush().catch(() => {});
    if (soonTimer) return;
    soonTimer = setTimeout(() => {
      soonTimer = null;
      void flush().catch(() => {});
    }, batchDelay);
    soonTimer.unref?.();
  }
  /** Sends what is waiting. Failed mails are retried later with growing pauses. */
  async function flush() {
    if (flushing) {
      flushAgain = true;
      return flushing;
    }
    flushing = (async () => {
      let sent = 0;
      do {
        flushAgain = false;
        sent += await flushPass();
      } while (flushAgain);
      return sent;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  // ---------------------------------------------------------------- checkpoints
  // The owner regularly folds everything up to a version vector into a checkpoint: the state
  // without the content of deleted things (see purgeState) plus the notes. Every member checks the
  // signed header against their own ops and then drops those ops; new members and members who
  // fell behind get the checkpoint itself instead of the history. So deleted mails, comments,
  // tasks and files leave every copy and are never sent to someone who joins later, and the log
  // only holds what happened since the last checkpoint.
  const notesOf = docs =>
    Object.fromEntries([...docs].map(([k, d]) => [k, Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64')]));
  const digestOf = (state, notes) => sha256(Buffer.from(canonical({ state: { ...state, ignored: 0 }, notes })));
  const dominates = (a, b) => Object.entries(b || {}).every(([k, n]) => (a[k] || 0) >= n);

  /** The checkpoint for `vv`, folded from this device's own ops; null while some of them are missing. */
  function foldTo(r, vv) {
    if (!dominates(versionVector(r), vv)) return null;
    const ops = r.ops.filter(op => op.seq <= (vv[op.author] || 0));
    const { state, docs } = fold(r.id, ops, r.base);
    const purged = purgeState(state, docs);
    const notes = notesOf(purged.docs);
    return { state: purged.state, notes, digest: digestOf(purged.state, notes) };
  }

  /** Replaces everything up to `header.vv` by the checkpoint. */
  async function adopt(r, header, body) {
    const before = stateOf(r);
    const named = new Set((r.outbox || []).flatMap(i => (i.kind === 'ops' ? i.ops : [])));
    r.held ||= {};
    const keep = [];
    for (const op of r.ops) {
      if (op.seq > (header.vv[op.author] || 0)) keep.push(op);
      else if (named.has(op.id)) r.held[op.id] = op;
    }
    r.ops = keep;
    r.base = { header, state: body.state, notes: body.notes };
    r.pendingCheckpoint = null;
    r.incoming = null;
    r.lc = Math.max(r.lc || 0, Number(header.lc) || 0);
    cache.delete(r.id);
    // File parts of deleted versions are removed from this device.
    const live = new Set(Object.values(stateOf(r).files).flatMap(f => f.versions.map(v => v.blob)));
    const gone = Object.values(before.files)
      .flatMap(f => f.versions)
      .filter(v => !live.has(v.blob));
    if (gone.length) await store.removeBlobs(gone.map(v => ({ blob: v.blob, chunks: v.chunks })));
    changed(r.id);
  }
  /** Ops that went into a checkpoint are kept only while a waiting mail still names them. */
  function releaseHeld(r) {
    if (!r.held) return;
    const named = new Set((r.outbox || []).flatMap(i => (i.kind === 'ops' ? i.ops : [])));
    for (const id of Object.keys(r.held)) if (!named.has(id)) delete r.held[id];
    if (!Object.keys(r.held).length) delete r.held;
  }
  function compactDue(r) {
    if (r.status !== 'active' || stateOf(r).owner !== keys.id) return false;
    // Spaces from before checkpoints get their first one right away.
    const first = !r.base && r.ops.length > 0;
    if (!first && !r.compactAsked && r.ops.length < COMPACT_OPS) return false;
    return Date.now() - (r.compactedAt || 0) >= compactPause;
  }
  /** Owner: makes a checkpoint of everything held and tells the other members. */
  async function compact(r) {
    const vv = versionVector(r);
    r.compactAsked = false;
    r.compactedAt = Date.now();
    if (r.base && canonical(vv) === canonical(r.base.header.vv)) return false;
    const target = foldTo(r, vv);
    const header = signed(keys, {
      v: 1,
      t: 'checkpoint',
      space: r.id,
      by: keys.id,
      vv,
      lc: r.lc || 0,
      digest: target.digest,
      at: clock()
    });
    await adopt(r, header, target);
    for (const m of recipientsOf(r)) queueCheckpoint(r, m, false);
    return true;
  }
  function queueCheckpoint(r, member, full) {
    const waiting = (r.outbox || []).find(i => i.kind === 'checkpoint' && i.to === member.id && !i.sending && !i.tries);
    if (waiting) waiting.full ||= full;
    else enqueue(r, member, { kind: 'checkpoint', full });
  }
  /** A checkpoint header: taken over once this device's own ops give the same digest. */
  async function tryCheckpoint(r, header) {
    if (r.base && !dominates(header.vv, r.base.header.vv)) return;
    const own = foldTo(r, header.vv);
    if (!own) {
      // Ops are missing: ask the owner, and check again when they are here.
      r.pendingCheckpoint = header;
      const owner = stateOf(r).members[header.by];
      if (owner && owner.id !== keys.id) askFor(r, owner, versionVector(r));
      return;
    }
    r.pendingCheckpoint = null;
    if (own.digest !== header.digest) {
      logger('spaces: a checkpoint does not match the local operations; the full log is kept');
      return;
    }
    await adopt(r, header, own);
  }
  function validHeader(r, header) {
    if (!header || header.v !== 1 || header.t !== 'checkpoint' || header.space !== r.id) return false;
    if (!/^[a-f0-9]{64}$/.test(String(header.digest)) || !header.vv || typeof header.vv !== 'object') return false;
    if (!Object.entries(header.vv).every(([a, n]) => /^[a-f0-9]{32}$/.test(a) && Number.isSafeInteger(n) && n >= 0))
      return false;
    // Only the owner makes checkpoints; any member may pass one on.
    const state = stateOf(r);
    const ownerId = state.owner || r.ownerId;
    const owner = state.members[ownerId] || (ownerId === r.ownerId ? r.ownerCard : null);
    return header.by === ownerId && Boolean(owner) && signatureValid(header, owner.signPub);
  }
  async function receiveCheckpoint(r, inner) {
    const { header } = inner;
    if (!validHeader(r, header)) return;
    if (r.base && (header.digest === r.base.header.digest || !dominates(header.vv, r.base.header.vv))) return;
    if (inner.parts === undefined) return tryCheckpoint(r, header);
    // The checkpoint itself, in parts (for new members and members who fell behind).
    const { part, parts, data } = inner;
    if (!Number.isInteger(parts) || parts < 1 || parts > MAX_CHECKPOINT_BYTES / CHECKPOINT_PART) return;
    if (!Number.isInteger(part) || part < 0 || part >= parts || typeof data !== 'string') return;
    if (r.incoming?.digest !== header.digest) r.incoming = { digest: header.digest, parts: [] };
    r.incoming.parts[part] = data;
    if (r.incoming.parts.filter(x => typeof x === 'string').length < parts) return;
    const text = r.incoming.parts.join('');
    r.incoming = null;
    // A member who has all the ops checks against their own fold and never takes anything else.
    const own = foldTo(r, header.vv);
    if (own) {
      if (own.digest === header.digest) await adopt(r, header, own);
      else logger('spaces: a checkpoint does not match the local operations; the full log is kept');
      return;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    const st = body?.state;
    const shapeOk =
      st &&
      typeof st === 'object' &&
      st.id === r.id &&
      ['members', 'notes', 'mails', 'comments', 'tasks', 'events', 'files', 'folders'].every(
        k => st[k] && typeof st[k] === 'object' && !Array.isArray(st[k])
      ) &&
      Array.isArray(st.activity) &&
      ['chat', 'chatGone'].every(
        k => st[k] === undefined || (st[k] && typeof st[k] === 'object' && !Array.isArray(st[k]))
      ) &&
      body.notes &&
      typeof body.notes === 'object' &&
      Object.values(body.notes).every(v => typeof v === 'string');
    if (!shapeOk || digestOf(st, body.notes) !== header.digest) return;
    try {
      fold(r.id, [], { state: st, notes: body.notes });
    } catch {
      return;
    }
    await adopt(r, header, { state: st, notes: body.notes });
  }

  // ---------------------------------------------------------------- local changes
  function author(r, type, data) {
    const op = {
      v: 1,
      space: r.id,
      author: keys.id,
      seq: (r.seq || 0) + 1,
      lc: (r.lc || 0) + 1,
      at: clock(),
      type,
      data: validateOpData(type, data)
    };
    op.id = `${keys.id}:${op.seq}`;
    const signedOp = signed(keys, op);
    r.seq = op.seq;
    return signedOp;
  }
  const writable = r => {
    if (r.status !== 'active') throw fail('Dieser Raum ist nicht mehr aktiv.', 'spaces_inactive', 409);
  };
  /** Records a change made on this device and sends it to everyone else. */
  async function apply(spaceId, type, data, { include = [] } = {}) {
    const r = record(spaceId);
    writable(r);
    let normalized;
    try {
      normalized = validateOpData(type, data);
    } catch {
      throw fail('Ungültige Eingabe.', 'spaces_invalid');
    }
    const state = stateOf(r);
    // Check the permission up front so the user gets an answer instead of a silently ignored op.
    const probe = structuredClone({ ...state, activity: [] });
    const op = author(r, type, normalized);
    const docs = view(r).docs;
    const probeDocs = new Map(
      type === 'note.edit' && docs.has(normalized.id) ? [[normalized.id, cloneDoc(docs.get(normalized.id))]] : []
    );
    if (!applyOp(probe, op, probeDocs)) {
      r.seq--;
      throw fail('Dafür fehlen in diesem Raum die Rechte oder der Eintrag existiert nicht.', 'spaces_forbidden', 403);
    }
    addOps(r, [op]);
    broadcastOps(r, [op], { include, urgent: URGENT_TYPES.has(type) });
    await store.save(r);
    changed(r.id);
    if (URGENT_TYPES.has(type)) void flush().catch(() => {});
    else soon();
    return op;
  }
  const cloneDoc = doc => {
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    return copy;
  };

  async function create({ name, description = '', accountId, email }) {
    const account = accountFor(accountId, email);
    const address = (email && account.addresses.includes(email.toLowerCase()) ? email : account.address).toLowerCase();
    const id = randomId(16);
    const r = {
      v: 1,
      id,
      accountId: account.id,
      email: address,
      myName: account.name || '',
      me: keys.id,
      ownerId: keys.id,
      status: 'active',
      epoch: 1,
      keys: { 1: b64u(newSymmetricKey()) },
      ops: [],
      seq: 0,
      lc: 0,
      outbox: [],
      invites: {},
      createdAt: clock()
    };
    let op;
    try {
      op = author(r, 'space.create', { name, description, owner: myCard(address, account.name) });
    } catch {
      throw fail('Bitte einen Namen für den Raum angeben (höchstens 120 Zeichen).', 'spaces_invalid');
    }
    addOps(r, [op]);
    await store.save(r);
    changed(id);
    return summary(r);
  }

  // ---------------------------------------------------------------- membership
  async function invite(spaceId, { email, role = 'editor', name = '' }) {
    const r = record(spaceId);
    writable(r);
    const state = stateOf(r);
    if (state.owner !== keys.id) throw fail('Nur der Besitzer kann einladen.', 'spaces_forbidden', 403);
    const address = String(email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) || address.length > 320)
      throw fail('Bitte eine gültige Mailadresse angeben.', 'spaces_invalid');
    if (!['editor', 'reader'].includes(role)) throw fail('Unbekannte Rolle.', 'spaces_invalid');
    if (Object.values(state.members).some(m => !m.removed && m.email === address))
      throw fail('Diese Person ist schon Mitglied.', 'spaces_member_exists', 409);
    const token = randomId(16);
    const expires = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
    r.invites ||= {};
    for (const [t, inv] of Object.entries(r.invites)) if (inv.email === address && !inv.used) delete r.invites[t];
    r.invites[token] = { email: address, role, name: String(name || '').slice(0, 200), expires, at: clock() };
    const owner = state.members[keys.id];
    const envelope = signed(keys, {
      v: 1,
      t: 'invite',
      space: r.id,
      from: keys.id,
      card: { id: owner.id, email: owner.email, name: owner.name, signPub: owner.signPub, boxPub: owner.boxPub },
      invite: { name: state.name, description: state.description, token, email: address, role, expires }
    });
    enqueue(r, { id: '', email: address }, { kind: 'invite', envelope });
    await store.save(r);
    changed(r.id);
    void flush().catch(() => {});
    return { email: address, role, expires };
  }

  async function revokeInvite(spaceId, email) {
    const r = record(spaceId);
    if (stateOf(r).owner !== keys.id)
      throw fail('Nur der Besitzer kann Einladungen zurückziehen.', 'spaces_forbidden', 403);
    for (const [t, inv] of Object.entries(r.invites || {}))
      if (inv.email === String(email).toLowerCase() && !inv.used) delete r.invites[t];
    await store.save(r);
    changed(r.id);
  }

  async function acceptInvitation(invitationId, { accountId } = {}) {
    const index = store.index();
    const inv = index.invitations.find(i => i.id === invitationId);
    if (!inv) throw fail('Einladung nicht gefunden.', 'spaces_invitation_missing', 404);
    if (Date.parse(inv.expires) < Date.now())
      throw fail('Diese Einladung ist abgelaufen. Bitte um eine neue.', 'spaces_invitation_expired', 410);
    const account = accountFor(accountId || inv.accountId, inv.email);
    if (!account.addresses.includes(inv.email))
      throw fail('Die Einladung gilt für eine andere Mailadresse.', 'spaces_invitation_address', 409);
    if (store.get(inv.space) && store.get(inv.space).status === 'active')
      throw fail('Du bist schon Mitglied dieses Raums.', 'spaces_member_exists', 409);
    const owner = validCard(inv.owner);
    const r = {
      v: 1,
      id: inv.space,
      accountId: account.id,
      email: inv.email,
      myName: account.name || '',
      me: keys.id,
      ownerId: owner.id,
      ownerCard: owner,
      name: inv.name,
      status: 'joining',
      epoch: 0,
      keys: {},
      ops: [],
      seq: 0,
      lc: 0,
      outbox: [],
      deferred: [],
      createdAt: clock()
    };
    const envelope = boxedEnvelope(
      r.id,
      owner,
      { t: 'join', token: inv.token, card: myCard(inv.email, account.name) },
      { card: myCard(inv.email, account.name) }
    );
    enqueue(r, owner, { kind: 'join', envelope });
    await store.save(r);
    await store.updateIndex(i => ({ ...i, invitations: i.invitations.filter(x => x.id !== invitationId) }));
    changed(r.id);
    void flush().catch(() => {});
    return summary(r);
  }

  async function declineInvitation(invitationId) {
    await store.updateIndex(i => ({ ...i, invitations: i.invitations.filter(x => x.id !== invitationId) }));
  }

  /** Owner: new space key for everyone still in the space. Called after removals. */
  function rotateKey(r) {
    r.epoch = (r.epoch || 1) + 1;
    r.keys[r.epoch] = b64u(newSymmetricKey());
    sendKeys(r, recipientsOf(r), { only: [r.epoch] });
  }
  function sendKeys(r, members, { only } = {}) {
    const epochs = Object.fromEntries(Object.entries(r.keys).filter(([n]) => !only || only.includes(Number(n))));
    for (const m of members) {
      const envelope = boxedEnvelope(r.id, m, { t: 'keys', epochs, current: r.epoch });
      enqueue(r, m, { kind: 'keys', envelope });
    }
  }

  async function removeMember(spaceId, memberId) {
    const r = record(spaceId);
    const state = stateOf(r);
    if (state.owner !== keys.id) throw fail('Nur der Besitzer kann Mitglieder entfernen.', 'spaces_forbidden', 403);
    const upTo = versionVector(r)[memberId] || 0;
    await apply(spaceId, 'member.remove', { member: memberId, upTo }, { include: [memberId] });
    rotateKey(r);
    await store.save(r);
    void flush().catch(() => {});
  }
  async function setRole(spaceId, memberId, role) {
    return apply(spaceId, 'member.role', { member: memberId, role });
  }
  async function leave(spaceId) {
    const r = record(spaceId);
    if (stateOf(r).owner === keys.id)
      throw fail(
        'Als Besitzer bitte zuerst den Raum an jemanden übergeben oder ihn auflösen.',
        'spaces_owner_leave',
        409
      );
    await apply(spaceId, 'member.leave', {});
    r.status = 'left';
    await store.save(r);
    changed(r.id);
  }
  async function transfer(spaceId, memberId) {
    return apply(spaceId, 'space.transfer', { to: memberId });
  }
  async function dissolve(spaceId) {
    const r = record(spaceId);
    await apply(spaceId, 'space.dissolve', {});
    r.status = 'dissolved';
    await store.save(r);
    changed(r.id);
  }
  /** Deletes this device's copy. Only for spaces this device is no longer active in. */
  async function deleteLocal(spaceId) {
    const r = record(spaceId);
    if (r.status === 'active')
      throw fail(
        'Ein aktiver Raum kann nicht nur lokal gelöscht werden. Bitte zuerst austreten oder auflösen.',
        'spaces_active',
        409
      );
    const blobs = Object.values(stateOf(r).files).flatMap(f =>
      f.versions.map(v => ({ blob: v.blob, chunks: v.chunks }))
    );
    await store.removeBlobs(blobs);
    await store.remove(spaceId);
    cache.delete(spaceId);
    changed(spaceId);
  }

  // ---------------------------------------------------------------- receiving
  const verifiedOp = (r, op, state) => {
    if (!op || !Number.isInteger(op.v) || op.v < 1 || op.space !== r.id || typeof op.author !== 'string') return null;
    if (
      op.id !== `${op.author}:${op.seq}` ||
      !Number.isInteger(op.seq) ||
      op.seq < 1 ||
      !Number.isInteger(op.lc) ||
      op.lc < 1
    )
      return null;
    if (typeof op.at !== 'string' || Number.isNaN(Date.parse(op.at))) return null;
    let card = state.members[op.author];
    if (!card && op.type === 'space.create' && op.author === r.ownerId) card = op.data?.owner;
    if (!card) return undefined; // author not known yet: keep for later
    if (memberIdOf(card.signPub, card.boxPub) !== op.author) return null;
    if (!signatureValid(op, card.signPub)) return null;
    // Correctly signed ops this version cannot apply (a newer format or op type, or data it
    // considers invalid) are kept unchanged and passed on: they close the author's sequence, so
    // version vectors match and members do not ask each other for them forever. The fold
    // ignores them.
    if (op.v !== 1 || !OP_TYPES.has(op.type)) return op;
    try {
      return { ...op, data: validateOpData(op.type, op.data) };
    } catch {
      return op;
    }
  };

  /** Verifies and stores incoming ops; ops by authors not yet known wait until they are. */
  function ingest(r, ops) {
    let pending = [...(r.pending || []), ...ops];
    let added = 0;
    for (let round = 0; round < 50 && pending.length; round++) {
      const state = stateOf(r);
      const ok = [];
      const later = [];
      for (const op of pending) {
        if (view(r).ids.has(op?.id) || (op && covered(r, op))) continue;
        const v = verifiedOp(r, op, state);
        if (v) ok.push(v);
        else if (v === undefined) later.push(op);
      }
      pending = later;
      if (!ok.length) break;
      added += addOps(r, ok);
    }
    r.pending = pending.slice(-5000);
    return added;
  }

  function wantedBlobs(r) {
    const state = stateOf(r);
    const want = [];
    for (const f of Object.values(state.files)) {
      if (f.deleted) continue;
      const latest = f.versions.at(-1);
      if (!latest || latest.size > AUTO_FETCH_LIMIT) continue;
      want.push(latest);
    }
    return want;
  }
  async function missingChunks(version) {
    const missing = [];
    for (let n = 0; n < version.chunks; n++) if (!(await store.hasChunk(version.blob, n))) missing.push(n);
    return missing;
  }

  async function handleInner(r, sender, inner, { boxed }) {
    const state = stateOf(r);
    switch (inner?.t) {
      case 'ops': {
        if (!Array.isArray(inner.ops) || inner.ops.length > 50_000) return;
        const before = r.status;
        const added = ingest(r, inner.ops);
        const after = stateOf(r);
        const me = after.members[keys.id];
        if (me?.removed && !me.left && before === 'active') r.status = 'removed';
        if (after.dissolved && r.status === 'active') r.status = 'dissolved';
        // The sender knows ops we lack: ask for them (once per message).
        if (inner.vv && typeof inner.vv === 'object' && r.status === 'active') {
          const mine = versionVector(r);
          const behind = Object.entries(inner.vv).some(([a, n]) => Number.isInteger(n) && n > (mine[a] || 0));
          if (behind && after.members[sender.id]) askFor(r, after.members[sender.id], mine);
        }
        if (added && r.pendingCheckpoint) await tryCheckpoint(r, r.pendingCheckpoint);
        // Fetch file contents of small, current versions automatically.
        if (added && r.status === 'active') {
          const blobs = [];
          for (const v of wantedBlobs(r)) for (const n of await missingChunks(v)) blobs.push({ blob: v.blob, n });
          if (blobs.length && after.members[sender.id])
            enqueue(r, after.members[sender.id], { kind: 'need', vv: null, blobs: blobs.slice(0, 200) });
        }
        return;
      }
      case 'need': {
        const member = state.members[sender.id];
        if (!member || member.removed) return;
        if (inner.vv && typeof inner.vv === 'object') {
          // Behind the last checkpoint: they get the checkpoint, then what came after it.
          const base = r.base?.header.vv || {};
          if (Object.entries(base).some(([a, n]) => (Number(inner.vv[a]) || 0) < n)) queueCheckpoint(r, member, true);
          const ids = r.ops.filter(op => op.seq > (Number(inner.vv[op.author]) || 0)).map(op => op.id);
          if (ids.length) sendOps(r, member, ids);
        }
        const known = new Set(
          Object.values(state.files)
            .filter(f => !f.deleted)
            .flatMap(f => f.versions.map(v => v.blob))
        );
        for (const b of Array.isArray(inner.blobs) ? inner.blobs.slice(0, 500) : []) {
          if (!known.has(b?.blob) || !Number.isInteger(b.n)) continue;
          if (await store.hasChunk(b.blob, b.n)) enqueue(r, member, { kind: 'blob', blob: b.blob, n: b.n });
        }
        return;
      }
      case 'blob': {
        const version = Object.values(state.files)
          .filter(f => !f.deleted)
          .flatMap(f => f.versions)
          .find(v => v.blob === inner.blob);
        if (!version || !Number.isInteger(inner.n) || inner.n < 0 || inner.n >= version.chunks) return;
        const data = Buffer.from(String(inner.data || ''), 'base64');
        // Store only chunks that decrypt with the key from the (signed) file operation.
        try {
          open(unb64u(version.key), JSON.parse(data.toString('utf8')), `blob.${version.blob}.${inner.n}`);
        } catch {
          return;
        }
        await store.putChunk(version.blob, inner.n, data);
        return;
      }
      case 'checkpoint':
        if (boxed) return;
        await receiveCheckpoint(r, inner);
        return;
      case 'keys': {
        if (!boxed) return;
        const ownerId = state.owner || r.ownerId;
        if (sender.id !== ownerId) return;
        for (const [n, k] of Object.entries(inner.epochs || {})) {
          if (/^\d{1,6}$/.test(n) && /^[A-Za-z0-9_-]{43}$/.test(k)) r.keys[n] = k;
        }
        if (Number.isInteger(inner.current) && r.keys[inner.current]) r.epoch = Math.max(r.epoch || 0, inner.current);
        if (r.status === 'joining' && r.epoch) {
          r.status = 'active';
          // Anything sealed before the key arrived can be read now.
          const deferred = r.deferred || [];
          r.deferred = [];
          for (const env of deferred) await receiveEnvelope(r.accountId, env, { replay: true });
        }
        return;
      }
      case 'join': {
        if (!boxed || state.owner !== keys.id || r.status !== 'active') return;
        const inv = r.invites?.[inner.token];
        let card;
        try {
          card = validCard(inner.card);
        } catch {
          return;
        }
        if (!inv || inv.used || Date.parse(inv.expires) < Date.now() || inv.email !== card.email) {
          logger('spaces: join request with an unknown, used or expired invitation ignored');
          return;
        }
        if (card.id !== sender.id) return;
        inv.used = clock();
        inv.member = card.id;
        await apply(r.id, 'member.add', { member: card, role: inv.role });
        const joined = stateOf(r).members[card.id];
        // Welcome: the current key, then a fresh checkpoint instead of the history, so nothing
        // deleted before they joined ever reaches them.
        sendKeys(r, [joined], { only: [r.epoch] });
        await compact(r);
        queueCheckpoint(r, joined, true);
        return;
      }
      default:
    }
  }

  /** Processes one envelope from a sync mail. Returns what happened, for logging/tests. */
  async function receiveEnvelope(accountId, env, { from = '', replay = false } = {}) {
    if (!env || env.v !== 1 || typeof env.t !== 'string' || !SPACE_ID.test(String(env.space || ''))) return 'invalid';
    if (env.t === 'invite') {
      let card;
      try {
        card = validCard(env.card);
      } catch {
        return 'invalid';
      }
      if (
        card.id !== memberIdOf(card.signPub, card.boxPub) ||
        card.id !== env.from ||
        !signatureValid(env, card.signPub)
      )
        return 'invalid';
      const inv = env.invite || {};
      const existing = store.get(env.space);
      if (existing && existing.status === 'active') return 'duplicate';
      if (typeof inv.token !== 'string' || !/^[a-f0-9]{32}$/.test(inv.token)) return 'invalid';
      if (store.index().invitations.some(i => i.space === env.space && i.token === inv.token)) return 'duplicate';
      const email = String(inv.email || '').toLowerCase();
      const entry = {
        id: randomId(8),
        space: env.space,
        token: inv.token,
        name: String(inv.name || '').slice(0, 120),
        description: String(inv.description || '').slice(0, 2000),
        role: inv.role === 'reader' ? 'reader' : 'editor',
        email,
        expires: String(inv.expires || ''),
        owner: card,
        ownerSafetyCode: safetyCode(card.signPub, card.boxPub),
        // A different From address than the inviter's card is shown as a warning.
        fromMismatch: Boolean(from && from.toLowerCase() !== card.email),
        accountId,
        receivedAt: clock()
      };
      await store.updateIndex(index => ({
        ...index,
        invitations: [...index.invitations.filter(i => i.space !== env.space), entry].slice(-200)
      }));
      changed(null);
      return 'invitation';
    }
    const r = store.get(env.space);
    if (!r || r.status === 'left') return 'unknown_space';
    const state = stateOf(r);
    let sender = state.members[env.from] || (env.from === r.ownerId ? r.ownerCard : null);
    if (!sender && env.t === 'boxed' && env.card) {
      try {
        sender = validCard(env.card);
      } catch {
        return 'invalid';
      }
    }
    if (!sender || memberIdOf(sender.signPub, sender.boxPub) !== env.from) return 'unknown_sender';
    if (!signatureValid(env, sender.signPub)) return 'invalid_signature';
    let inner;
    try {
      if (env.t === 'sealed') {
        const k = epochKey(r, env.epoch);
        if (!k) {
          if (!replay && r.status === 'joining') {
            r.deferred = [...(r.deferred || []), env].slice(-500);
            await store.save(r);
            return 'deferred';
          }
          return 'no_key';
        }
        inner = JSON.parse(open(k, env.box, `space.${r.id}.${env.epoch}`).toString('utf8'));
      } else if (env.t === 'boxed') {
        if (env.to !== keys.id) return 'not_for_me';
        const k = keys.unwrap(env.wrap);
        inner = JSON.parse(open(k, env.box, `boxed.${r.id}.${keys.id}`).toString('utf8'));
      } else return 'invalid';
    } catch {
      return 'undecryptable';
    }
    await handleInner(r, { ...sender, id: env.from }, inner, { boxed: env.t === 'boxed' });
    await store.save(r);
    changed(r.id);
    if (!replay) soon();
    return 'ok';
  }

  // ---------------------------------------------------------------- reading
  const publicMember = m => ({
    id: m.id,
    email: m.email,
    name: m.name,
    role: m.role,
    joinedAt: m.joinedAt,
    removed: m.removed || null,
    left: Boolean(m.left),
    me: m.id === keys.id,
    safetyCode: safetyCode(m.signPub, m.boxPub)
  });
  const chatOrder = (a, b) => a.lc - b.lc || (a.by < b.by ? -1 : a.by > b.by ? 1 : a.seq - b.seq);
  const chatList = state => Object.values(state.chat || {}).sort(chatOrder);
  const lastChat = state => chatList(state).at(-1) || null;
  const unreadOf = (r, state) => (r.chatUnread || []).filter(id => state.chat?.[id] && state.chat[id].by !== keys.id);

  function summary(r) {
    const state = stateOf(r);
    const openTasks = Object.values(state.tasks).filter(t => !t.deleted && t.status !== 'done').length;
    return {
      id: r.id,
      name: state.name || r.name || '',
      description: state.description || '',
      status: r.status,
      role: state.members[keys.id]?.role || null,
      owner: state.owner === keys.id,
      accountId: r.accountId,
      email: r.email,
      members: Object.values(state.members).filter(m => !m.removed).length,
      openTasks,
      updatedAt: [state.activity.at(-1)?.at || r.createdAt, lastChat(state)?.at || ''].sort().at(-1),
      unreadChat: unreadOf(r, state).length,
      pendingMails: (r.outbox || []).length,
      sendError: (r.outbox || []).find(i => i.error)?.error || null
    };
  }

  function detail(spaceId) {
    const r = record(spaceId);
    const { state, docs } = view(r);
    const notes = Object.values(state.notes)
      .filter(n => !n.deleted)
      .map(n => ({ ...n, text: docs.get(n.id) ? noteText(docs.get(n.id)) : '' }));
    const files = Object.values(state.files)
      .filter(f => !f.deleted)
      .map(f => ({
        id: f.id,
        name: f.name,
        folder: f.folder,
        createdAt: f.createdAt,
        createdBy: f.createdBy,
        versions: f.versions.map((v, i) => ({
          n: i + 1,
          size: v.size,
          mime: v.mime,
          at: v.at,
          by: v.by,
          sha256: v.sha256
        }))
      }));
    return {
      ...summary(r),
      me: keys.id,
      mySafetyCode: keys.safetyCode,
      dissolved: state.dissolved,
      ai: state.ai,
      members: Object.values(state.members).map(publicMember),
      invites:
        state.owner === keys.id
          ? Object.values(r.invites || {})
              .filter(i => !i.used)
              .map(i => ({
                email: i.email,
                role: i.role,
                expires: i.expires,
                expired: Date.parse(i.expires) < Date.now()
              }))
          : [],
      notes,
      mails: Object.values(state.mails).sort((a, b) =>
        String(b.date || b.addedAt).localeCompare(String(a.date || a.addedAt))
      ),
      comments: Object.values(state.comments).sort((a, b) => a.at.localeCompare(b.at)),
      tasks: Object.values(state.tasks).filter(t => !t.deleted),
      events: Object.values(state.events)
        .filter(e => !e.deleted)
        .sort((a, b) => String(a.start).localeCompare(String(b.start))),
      files,
      folders: Object.keys(state.folders).sort(),
      activity: state.activity.slice(-300).reverse()
    };
  }

  function list() {
    return {
      identity: { id: keys.id, safetyCode: keys.safetyCode },
      // Sync mails in a newer format arrived: another member uses a newer Levuvo version.
      updateNeeded: Object.values(store.index().cursors || {}).some(c => c?.future?.length > 0),
      spaces: store
        .all()
        .map(summary)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      invitations: store
        .index()
        .invitations.filter(i => !store.get(i.space) || store.get(i.space).status !== 'active')
        .map(i => ({
          id: i.id,
          space: i.space,
          name: i.name,
          description: i.description,
          role: i.role,
          email: i.email,
          expires: i.expires,
          expired: Date.parse(i.expires) < Date.now(),
          from: { name: i.owner.name, email: i.owner.email },
          safetyCode: i.ownerSafetyCode,
          fromMismatch: i.fromMismatch,
          accountId: i.accountId
        }))
    };
  }

  // ---------------------------------------------------------------- notes (Yjs)
  function noteState(spaceId, noteId) {
    const r = record(spaceId);
    const doc = view(r).docs.get(noteId);
    if (!doc || !stateOf(r).notes[noteId] || stateOf(r).notes[noteId].deleted)
      throw fail('Notiz nicht gefunden.', 'spaces_missing', 404);
    return { update: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), text: noteText(doc) };
  }
  async function editNote(spaceId, noteId, updateB64) {
    if (typeof updateB64 !== 'string' || !updateB64) throw fail('Ungültige Eingabe.', 'spaces_invalid');
    // Reject updates Yjs cannot read, before they are signed and sent to everyone.
    try {
      Y.decodeUpdate(Buffer.from(updateB64, 'base64'));
    } catch {
      throw fail('Ungültige Eingabe.', 'spaces_invalid');
    }
    return apply(spaceId, 'note.edit', { id: noteId, update: updateB64 });
  }
  async function createNote(spaceId, { title = '', text = '', checklist = false } = {}) {
    const id = randomId(16);
    await apply(spaceId, 'note.create', { id, title });
    if (text) await appendToNote(spaceId, id, text, { checklist });
    return id;
  }
  async function appendToNote(spaceId, noteId, text, { checklist = false } = {}) {
    const r = record(spaceId);
    const doc = view(r).docs.get(noteId);
    if (!doc) throw fail('Notiz nicht gefunden.', 'spaces_missing', 404);
    const update = appendTextUpdate(cloneDoc(doc), text, { checklist });
    return apply(spaceId, 'note.edit', { id: noteId, update: Buffer.from(update).toString('base64') });
  }

  // ---------------------------------------------------------------- files
  async function addFile(spaceId, { name, folder = '', mime = 'application/octet-stream', data, fileId = null }) {
    const r = record(spaceId);
    writable(r);
    if (!Buffer.isBuffer(data)) throw fail('Datei fehlt.', 'spaces_invalid');
    if (data.length > MAX_FILE_SIZE)
      throw fail('Dateien in Räumen dürfen höchstens 250 MB groß sein.', 'spaces_file_too_large', 413);
    const key = newSymmetricKey();
    const blob = randomId(16);
    const chunks = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
    for (let n = 0; n < chunks; n++) {
      const part = data.subarray(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE);
      await store.putChunk(blob, n, Buffer.from(JSON.stringify(seal(key, part, `blob.${blob}.${n}`))));
    }
    const version = { blob, key: b64u(key), size: data.length, sha256: sha256(data), mime, chunks, storage: 'mail' };
    const id = fileId || randomId(16);
    try {
      if (fileId) await apply(spaceId, 'file.version', { id, version });
      else await apply(spaceId, 'file.add', { id, name, folder, version });
    } catch (err) {
      await store.removeBlobs([{ blob, chunks }]);
      throw err;
    }
    // Small files go to everyone right away; larger ones are fetched when someone opens them.
    if (data.length <= AUTO_FETCH_LIMIT)
      for (const m of recipientsOf(r)) for (let n = 0; n < chunks; n++) enqueue(r, m, { kind: 'blob', blob, n });
    await store.save(r);
    void flush().catch(() => {});
    return id;
  }
  /**
   * Whether a file version can be read right now, without decrypting it. Missing parts are
   * requested, and the answer is spaces_file_pending meanwhile.
   */
  async function availableVersion(spaceId, fileId, versionNumber) {
    const r = record(spaceId);
    const state = stateOf(r);
    const f = state.files[fileId];
    if (!f || f.deleted) throw fail('Datei nicht gefunden.', 'spaces_missing', 404);
    const version = versionNumber ? f.versions[versionNumber - 1] : f.versions.at(-1);
    if (!version) throw fail('Version nicht gefunden.', 'spaces_missing', 404);
    const missing = await missingChunks(version);
    if (missing.length) {
      // Ask the person who uploaded it (or the owner) to send the missing parts.
      const source = state.members[version.by]?.removed ? state.members[state.owner] : state.members[version.by];
      if (source && source.id !== keys.id && r.status === 'active') {
        enqueue(r, source, { kind: 'need', vv: null, blobs: missing.map(n => ({ blob: version.blob, n })) });
        await store.save(r);
        void flush().catch(() => {});
      }
      throw fail(
        'Die Datei wird gerade von einem anderen Mitglied geholt. Bitte gleich noch einmal versuchen.',
        'spaces_file_pending',
        409
      );
    }
    return { f, version };
  }
  /** Whether a file version can be downloaded now, without decrypting it (for the download button). */
  async function checkFile(spaceId, fileId, versionNumber) {
    await availableVersion(spaceId, fileId, versionNumber);
    return { ok: true };
  }
  async function readFile(spaceId, fileId, versionNumber) {
    const { f, version } = await availableVersion(spaceId, fileId, versionNumber);
    const key = unb64u(version.key);
    const parts = [];
    for (let n = 0; n < version.chunks; n++) {
      const raw = await store.getChunk(version.blob, n);
      parts.push(open(key, JSON.parse(raw.toString('utf8')), `blob.${version.blob}.${n}`));
    }
    const data = Buffer.concat(parts);
    if (sha256(data) !== version.sha256) throw fail('Die Datei ist beschädigt.', 'spaces_file_corrupt', 422);
    return { name: f.name, mime: version.mime, data };
  }

  /** Asks every member for everything we might lack (manual "sync now"). */
  async function resync(spaceId) {
    const r = record(spaceId);
    if (r.status !== 'active') return;
    const vv = versionVector(r);
    for (const m of recipientsOf(r)) enqueue(r, m, { kind: 'need', vv });
    await store.save(r);
    return flush();
  }

  // ---------------------------------------------------------------- chat
  /**
   * Chat of a space, oldest first: the newest `limit` messages, or those before the message
   * `before` (for scrolling back). Unread ones carry `unread: true`.
   */
  function chat(spaceId, { before = '', limit = 100 } = {}) {
    const r = record(spaceId);
    const state = stateOf(r);
    let all = chatList(state);
    if (before) {
      const at = all.findIndex(m => m.id === before);
      if (at >= 0) all = all.slice(0, at);
    }
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    const unread = new Set(unreadOf(r, state));
    const messages = all.slice(-max).map(m => ({
      id: m.id,
      text: m.text,
      at: m.at,
      by: m.by,
      mine: m.by === keys.id,
      replyTo: m.replyTo || null,
      ai: Boolean(m.ai),
      editedAt: m.editedAt || null,
      unread: unread.has(m.id)
    }));
    // Quoted messages that are not in this page (or were deleted): a short preview, or gone.
    const quoted = {};
    for (const m of messages)
      if (m.replyTo && !quoted[m.replyTo] && !messages.some(x => x.id === m.replyTo)) {
        const q = state.chat?.[m.replyTo];
        quoted[m.replyTo] = q ? { by: q.by, text: q.text.slice(0, 200) } : null;
      }
    return {
      messages,
      quoted,
      more: all.length > max,
      unread: unread.size,
      rev: revs.get(r.id) || 0,
      canWrite: r.status === 'active' && ['owner', 'editor'].includes(state.members[keys.id]?.role),
      pending: (r.outbox || []).some(i => i.kind === 'ops' && i.urgent)
    };
  }
  async function postChat(spaceId, { text, replyTo = null, ai = false }) {
    const id = randomId(16);
    await apply(spaceId, 'chat.post', { id, text, replyTo: replyTo || undefined, ai: ai === true });
    return id;
  }
  /** Everything in the chat counts as read on this device (no read receipts are sent). */
  async function markChatRead(spaceId, ids = null) {
    const r = record(spaceId);
    if (!r.chatUnread?.length) return;
    // With ids: only what the user actually saw; a message that arrived meanwhile stays unread.
    const seen = Array.isArray(ids) ? new Set(ids.map(String)) : null;
    const next = seen ? r.chatUnread.filter(id => !seen.has(id)) : [];
    if (next.length === r.chatUnread.length) return;
    r.chatUnread = next;
    await store.save(r);
    changed(r.id);
  }
  /**
   * Resolves on the next change of the space (or of anything, without an id) after `rev`, or
   * after `ms`. Lets the interface show a message the moment its sync mail was processed.
   */
  function waitForChange(spaceId, rev, ms = 25_000) {
    if (spaceId !== undefined && (revs.get(spaceId) || 0) !== Number(rev)) return Promise.resolve(true);
    return new Promise(resolve => {
      const w = {
        id: spaceId,
        done: () => {
          clearTimeout(timer);
          waiters.delete(w);
          resolve(true);
        }
      };
      const timer = setTimeout(() => {
        waiters.delete(w);
        resolve(false);
      }, ms);
      waiters.add(w);
    });
  }

  return {
    identity: { id: keys.id, safetyCode: keys.safetyCode },
    list,
    chat,
    postChat,
    markChatRead,
    waitForChange,
    detail,
    create,
    invite,
    revokeInvite,
    acceptInvitation,
    declineInvitation,
    removeMember,
    setRole,
    leave,
    transfer,
    dissolve,
    deleteLocal,
    apply,
    noteState,
    editNote,
    createNote,
    appendToNote,
    addFile,
    readFile,
    checkFile,
    resync,
    receiveEnvelope,
    flush,
    onChange: fn => (listeners.add(fn), () => listeners.delete(fn)),
    accountIds: () => [
      ...new Set(
        store
          .all()
          .filter(r => ['active', 'joining'].includes(r.status))
          .map(r => r.accountId)
      )
    ],
    hasPendingMail: () => store.all().some(r => r.outbox?.length),
    stateForAssistant: spaceId => {
      const r = record(spaceId);
      return { record: r, ...view(r) };
    },
    newId: () => randomId(16)
  };
}
