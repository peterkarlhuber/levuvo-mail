// HTTP API for shared spaces (local only, like every other route).
import path from 'node:path';
import { openSpaceStore } from './spaces/store.mjs';
import { createSpaceService, MAX_FILE_SIZE } from './spaces/service.mjs';
import { createMailTransport } from './spaces/mail-transport.mjs';
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
  'folder.delete'
]);

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
  let lastFullScan = 0;
  let running = null;
  async function runSync(s, { all = false } = {}) {
    if (running) return running;
    running = (async () => {
      const { transport } = await ready();
      const configured = ctx.accounts().filter(a => a.imap?.configured);
      // Accounts with spaces every run; every account now and then, for new invitations.
      const full = all || Date.now() - lastFullScan > 5 * 60_000;
      if (full) lastFullScan = Date.now();
      const ids = full ? configured.map(a => a.id) : s.accountIds().filter(id => configured.some(a => a.id === id));
      let received = 0;
      const errors = [];
      for (const id of ids) {
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
    });
    return running;
  }
  ctx.spaces = {
    ready,
    addMail,
    error: () => spacesError,
    sync: async opts => runSync(await service(), opts),
    // Background job (wired from app.mjs): only once spaces exist or the user opened them.
    tick: async () => {
      try {
        const s = await service();
        if (!s.list().spaces.length && !s.hasPendingMail() && Date.now() - lastFullScan < 15 * 60_000) return;
        await runSync(s);
      } catch {}
    }
  };
  registerSpaceTools(ctx, { service });
}

export const spacesDir = dataDir => path.join(dataDir, 'spaces');
