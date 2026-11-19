// HTTP API for shared spaces (local only, like every other route).
import path from 'node:path';
import { openSpaceStore } from './spaces/store.mjs';
import { createSpaceService, MAX_FILE_SIZE } from './spaces/service.mjs';
import { createMailTransport, snapshotHasSyncMail } from './spaces/mail-transport.mjs';
import { loadParsedMessage } from './message-service.mjs';
import { htmlToText } from './html-mail.mjs';
import { attachmentBytes, cleanFilename, downloadHeaders, validFolder, validUid } from './message-utils.mjs';
import { resolveAccount } from './accounts.mjs';
import { registerSpaceTools } from './spaces/tools.mjs';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const ACTION = 'spaces-v1';
// Content operations the interface may send directly; membership has its own routes.
const DIRECT_OPS = new Set([
  'space.update',
  'ai.settings',
  'note.update',
  'note.delete',
  'mail.remove',
  'comment.add',
  'comment.edit',
  'comment.delete',
  'task.upsert',
  'task.delete',
  'event.upsert',
  'event.delete',
  'file.update',
  'file.delete',
  'folder.create',
  'folder.delete',
  'chat.edit',
  'chat.delete'
]);
const CHAT_WAIT_MS = 25_000;
// Receiving: right away when the IDLE connection reports a sync mail; otherwise polled. With a
// healthy IDLE connection a slow safety poll is enough (junk folder, missed pushes); without
// one, accounts with spaces are polled often so chat stays usable.
const WAKE_DELAY_MS = 300;
const POLL_IDLE_MS = 2 * 60_000;
const POLL_NO_IDLE_MS = 30_000;
const FULL_SCAN_MS = 5 * 60_000;
export const SPACES_TICK_MS = 15_000;

export async function openSpaces(ctx, dir) {
  const store = await openSpaceStore({ dir, vault: ctx.store });
  const transport = createMailTransport(ctx, store);
  const service = createSpaceService({
    store,
    transport,
    logger: ctx.logger,
    // Changes made within 20 s travel as one sync mail per member.
    batchDelay: 20_000,
    accounts: () =>
      ctx
        .accounts()
        .filter(a => a.imap?.configured !== false)
        .map(a => ({
          id: a.id,
          address: String(a.imap.user || '').toLowerCase(),
          name: a.displayName || '',
          addresses: ctx.accountAddresses(a)
        }))
  });
  return { store, transport, service };
}

export function registerSpaceRoutes(ctx, { dir }) {
  const { api, requireAction } = ctx;
  const errorResponse = (reply, err) => ctx.errorResponse(reply, err, { domain: 'spaces' });
  let spaces = null;
  let spacesError = null;
  let opening = null;
  /** Opened on first use so a locked keychain only affects this feature. */
  async function ready() {
    if (spaces) return spaces;
    opening ||= openSpaces(ctx, dir)
      .then(s => {
        spaces = s;
        spacesError = null;
        return s;
      })
      .catch(err => {
        spacesError = err;
        throw err;
      })
      .finally(() => {
        opening = null;
      });
    return opening;
  }
  const service = async () => (await ready()).service;

  const guard = (route, handler, limit = 64 * 1024) =>
    api.post(route, { bodyLimit: limit }, async (request, reply) => {
      if (!requireAction(request, reply, ACTION)) return;
      try {
        return await handler(request, reply, await service());
      } catch (err) {
        return errorResponse(reply, err);
      }
    });
  const read = (route, handler) =>
    api.get(route, async (request, reply) => {
      try {
        return await handler(request, reply, await service());
      } catch (err) {
        return errorResponse(reply, err);
      }
    });

  read('/api/spaces', async (_r, _reply, s) => s.list());
  read('/api/spaces/:id', async (request, _reply, s) => s.detail(request.params.id));
  read('/api/spaces/:id/notes/:note', async (request, _reply, s) =>
    s.noteState(request.params.id, request.params.note)
  );
  read('/api/spaces/:id/files/:file', async (request, reply, s) => {
    const version = request.query?.v ? Number(request.query.v) : undefined;
    if (version !== undefined && (!Number.isInteger(version) || version < 1))
      throw fail('Ungültige Version.', 'spaces_invalid');
    // ?check=1: only whether it can be downloaded now (no decryption, no transfer).
    if (request.query?.check) return s.checkFile(request.params.id, request.params.file, version);
    const file = await s.readFile(request.params.id, request.params.file, version);
    // Always a download, never rendered inside the app (content comes from other people).
    for (const [k, v] of Object.entries(downloadHeaders(file.name))) reply.header(k, v);
    return reply.type('application/octet-stream').send(file.data);
  });

  // Chat: messages, waiting for the next change (long poll), writing and marking as read.
  read('/api/spaces/:id/chat', async (request, _reply, s) =>
    s.chat(request.params.id, {
      before: String(request.query?.before || '').slice(0, 64),
      limit: Number(request.query?.limit) || 100
    })
  );
  read('/api/spaces/:id/chat/wait', async (request, _reply, s) => {
    const rev = Number(request.query?.rev);
    if (!Number.isSafeInteger(rev) || rev < 0) throw fail('Ungültige Eingabe.', 'spaces_invalid');
    s.chat(request.params.id, { limit: 1 }); // 404 for unknown spaces before waiting
    const changed = await s.waitForChange(request.params.id, rev, CHAT_WAIT_MS);
    return { changed };
  });
  guard('/api/spaces/:id/chat/post', async (request, _reply, s) => {
    const b = request.body || {};
    // Written by the user: never marked as AI-generated here (the assistant has its own tool).
    const id = await s.postChat(request.params.id, { text: b.text, replyTo: b.replyTo || null });
    return { id };
  });
  guard('/api/spaces/:id/chat/read', async (request, _reply, s) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids.slice(0, 2000) : null;
    await s.markChatRead(request.params.id, ids);
    return { ok: true };
  });

  guard('/api/spaces/create', async (request, _reply, s) => {
    const b = request.body || {};
    return s.create({ name: b.name, description: b.description || '', accountId: b.accountId, email: b.email });
  });
  guard('/api/spaces/sync', async (_request, _reply, s) => runSync(s, { all: true }));
  guard('/api/spaces/invitations/:inv/accept', async (request, _reply, s) =>
    s.acceptInvitation(request.params.inv, { accountId: request.body?.accountId })
  );
  guard('/api/spaces/invitations/:inv/decline', async (request, _reply, s) => {
    await s.declineInvitation(request.params.inv);
    return { ok: true };
  });
  guard('/api/spaces/:id/invite', async (request, _reply, s) =>
    s.invite(request.params.id, { email: request.body?.email, role: request.body?.role, name: request.body?.name })
  );
  guard('/api/spaces/:id/invite/revoke', async (request, _reply, s) => {
    await s.revokeInvite(request.params.id, String(request.body?.email || ''));
    return { ok: true };
  });
  guard('/api/spaces/:id/members/:member/remove', async (request, _reply, s) => {
    await s.removeMember(request.params.id, request.params.member);
    return s.detail(request.params.id);
  });
  guard('/api/spaces/:id/members/:member/role', async (request, _reply, s) => {
    await s.setRole(request.params.id, request.params.member, request.body?.role);
    return s.detail(request.params.id);
  });
  guard('/api/spaces/:id/transfer', async (request, _reply, s) => {
    await s.transfer(request.params.id, request.body?.member);
    return s.detail(request.params.id);
  });
  guard('/api/spaces/:id/leave', async (request, _reply, s) => {
    await s.leave(request.params.id);
    return { ok: true };
  });
  guard('/api/spaces/:id/dissolve', async (request, _reply, s) => {
    if (request.body?.confirm !== true) throw fail('Bitte bestätigen.', 'spaces_confirm');
    await s.dissolve(request.params.id);
    return { ok: true };
  });
  guard('/api/spaces/:id/delete-local', async (request, _reply, s) => {
    if (request.body?.confirm !== true) throw fail('Bitte bestätigen.', 'spaces_confirm');
    await s.deleteLocal(request.params.id);
    return { ok: true };
  });
  guard('/api/spaces/:id/resync', async (request, _reply, s) => {
    await s.resync(request.params.id);
    return { ok: true };
  });
  guard(
    '/api/spaces/:id/op',
    async (request, _reply, s) => {
      const { type, data } = request.body || {};
      if (!DIRECT_OPS.has(type)) throw fail('Unbekannte Aktion.', 'spaces_invalid');
      const op = await s.apply(request.params.id, type, data || {});
      return { ok: true, op: op.id };
    },
    2 * 1024 * 1024
  );
  guard('/api/spaces/:id/notes/create', async (request, _reply, s) => {
    const id = await s.createNote(request.params.id, {
      title: request.body?.title || '',
      text: request.body?.text || ''
    });
    return { id };
  });
  guard(
    '/api/spaces/:id/notes/:note/edit',
    async (request, _reply, s) => {
      await s.editNote(request.params.id, request.params.note, request.body?.update);
      return { ok: true };
    },
    3 * 1024 * 1024
  );
  // Pin a mail (or a whole thread, one call per message) to a space, optionally with attachments.
  async function addMail(spaceId, b = {}) {
    const s = await service();
    const account = resolveAccount(ctx.accounts(), b.account);
    if (!validFolder(b.folder) || !validUid(b.uid)) throw fail('Ungültige Nachricht.', 'spaces_invalid');
    const loaded = await ctx.withImap(client => loadParsedMessage(client, b.folder, Number(b.uid)), account);
    if (!loaded) throw fail('Nachricht nicht mehr vorhanden.', 'spaces_missing', 404);
    const { parsed } = loaded;
    const files = [];
    const attachments = (parsed.attachments || []).filter(a => a.disposition !== 'inline' || !a.contentId);
    for (const [index, att] of attachments.entries()) {
      const bytes = attachmentBytes(att);
      let file = null;
      if (b.withAttachments === true && bytes.length) {
        file = await s.addFile(spaceId, {
          name: cleanFilename(att.filename, index),
          folder: 'Mail-Anhänge',
          mime: String(att.mimeType || 'application/octet-stream').slice(0, 200),
          data: bytes
        });
      }
      files.push({ name: cleanFilename(att.filename, index), size: bytes.length, file });
    }
    const addr = a => (a?.address ? { name: a.name || '', address: a.address } : null);
    const id = s.newId();
    await s.apply(spaceId, 'mail.add', {
      id,
      thread: String(parsed.inReplyTo || parsed.messageId || '').slice(0, 200),
      messageId: String(parsed.messageId || '').slice(0, 998),
      subject: String(parsed.subject || '').slice(0, 998),
      from: addr(parsed.from),
      to: (parsed.to || []).map(addr).filter(Boolean).slice(0, 100),
      cc: (parsed.cc || []).map(addr).filter(Boolean).slice(0, 100),
      date: parsed.date && !Number.isNaN(Date.parse(parsed.date)) ? new Date(parsed.date).toISOString() : null,
      text: String(parsed.text || htmlToText(parsed.html || '') || '').slice(0, 500_000),
      attachments: files.slice(0, 50)
    });
    return { id };
  }
  // Pin a mail to a space (one call per message of a thread), optionally with attachments.
  guard('/api/spaces/:id/mails/add', async request => addMail(request.params.id, request.body || {}));

  // File upload: raw bytes, metadata in the query string.
  api.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_FILE_SIZE },
    (_req, body, done) => done(null, body)
  );
  api.post('/api/spaces/:id/files/upload', { bodyLimit: MAX_FILE_SIZE }, async (request, reply) => {
    if (
      request.headers['x-levuvo-action'] !== ACTION ||
      !String(request.headers['content-type'] || '')
        .toLowerCase()
        .startsWith('application/octet-stream')
    )
      return reply.code(403).send({ error: 'Lokale Aktion nicht autorisiert.' });
    try {
      const q = request.query || {};
      const s = await service();
      const id = await s.addFile(request.params.id, {
        name: cleanFilename(String(q.name || ''), 0),
        folder: String(q.folder || ''),
        mime: String(q.mime || 'application/octet-stream').slice(0, 200),
        data: request.body,
        fileId: q.file ? String(q.file) : null
      });
      return { id };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ background sync
  // Transport-neutral: the service hands envelopes to `transport.send` and takes them from
  // `receiveEnvelope`. What wakes the receive is decided here (IDLE push, polling). A relay
  // server could later be one more source that calls `wake`, and one more way to send.
  let lastFullScan = 0;
  const lastRun = new Map(); // account id → time of the last receive
  let running = null;
  let again = null; // accounts asked for while a run was busy
  async function runSync(s, { all = false, ids: only = null } = {}) {
    if (running) {
      if (only) {
        again ||= new Set();
        for (const id of only) again.add(id);
      }
      return running;
    }
    running = (async () => {
      const { transport } = await ready();
      const configured = ctx.accounts().filter(a => a.imap?.configured);
      // Accounts with spaces every run; every account now and then, for new invitations.
      const full = all || (!only && Date.now() - lastFullScan > FULL_SCAN_MS);
      if (full) lastFullScan = Date.now();
      const ids = only
        ? only.filter(id => configured.some(a => a.id === id))
        : full
          ? configured.map(a => a.id)
          : s.accountIds().filter(id => configured.some(a => a.id === id));
      let received = 0;
      const errors = [];
      for (const id of ids) {
        lastRun.set(id, Date.now());
        try {
          received += await transport.receive(id, (envelope, from) => s.receiveEnvelope(id, envelope, { from }));
        } catch (err) {
          errors.push({ account: id, code: err.code || 'imap_failed' });
        }
      }
      const sent = await s.flush().catch(() => 0);
      return { received, sent, errors };
    })().finally(() => {
      running = null;
      if (again?.size) {
        const next = [...again];
        again = null;
        void service()
          .then(s => runSync(s, { ids: next }))
          .catch(() => {});
      }
    });
    return running;
  }

  // New mail pushed over the IMAP IDLE connection the app keeps for the inbox anyway.
  const snapshots = new Map();
  const wakeTimers = new Map();
  function wake(accountId) {
    if (wakeTimers.has(accountId)) return;
    const timer = setTimeout(() => {
      wakeTimers.delete(accountId);
      void service()
        .then(s => runSync(s, { ids: [accountId] }))
        .catch(() => {});
    }, WAKE_DELAY_MS);
    timer.unref?.();
    wakeTimers.set(accountId, timer);
  }
  ctx.watchers?.subscribe?.((accountId, snapshot) => {
    const prev = snapshots.get(accountId);
    snapshots.set(accountId, { uidValidity: snapshot?.uidValidity, highestUid: snapshot?.highestUid });
    if (spaces && snapshotHasSyncMail(prev, snapshot)) wake(accountId);
  });
  const idleHealthy = id => {
    const st = ctx.watchers?.status?.(id);
    return Boolean(st?.connected && st?.healthy);
  };

  ctx.spaces = {
    ready,
    addMail,
    wake,
    error: () => spacesError,
    sync: async opts => runSync(await service(), opts),
    // Background job (wired from app.mjs, every SPACES_TICK_MS): only once spaces exist or the
    // user opened them.
    tick: async () => {
      try {
        const s = await service();
        const now = Date.now();
        if (!s.list().spaces.length && !s.hasPendingMail() && now - lastFullScan < 15 * 60_000) return;
        if (now - lastFullScan > FULL_SCAN_MS) return void (await runSync(s));
        const due = s
          .accountIds()
          .filter(id => now - (lastRun.get(id) || 0) >= (idleHealthy(id) ? POLL_IDLE_MS : POLL_NO_IDLE_MS));
        if (due.length) await runSync(s, { ids: due });
        else if (s.hasPendingMail()) await s.flush();
      } catch {}
    }
  };
  registerSpaceTools(ctx, { service });
}

export const spacesDir = dataDir => path.join(dataDir, 'spaces');
