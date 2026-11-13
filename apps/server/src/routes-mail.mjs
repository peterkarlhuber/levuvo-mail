// Mail routes: folders, lists, search, reading, actions, drafts, sending, scheduling,
// filters (Sieve), local index and background jobs.
import { folderName, cleanLimit, cleanBeforeUid } from './config.mjs';
import { publicAccounts, accountScopedRequestKey } from './accounts.mjs';
import { validFolder, validUid, validAttachmentIndex, downloadHeaders, attachmentBytes } from './message-utils.mjs';
import { loadParsedMessage } from './message-service.mjs';
import { validateSendPayload, publicSendStatus, findSentFolder } from './send-utils.mjs';
import { composeRawEmail, submitEmail, appendToSent } from './send-service.mjs';
import {
  validateActionInput,
  validateBatchInput,
  performMessageAction,
  createArchiveFolder,
  findSpecialFolder
} from './mail-actions.mjs';
import { loadThread } from './thread.mjs';
import { parseUnsubscribe, oneClickUnsubscribe } from './unsubscribe.mjs';
import {
  buildProtectedFile,
  findProtectedBox,
  openPayload,
  protectedNotice,
  PROTECTED_FILENAME
} from './protected-message.mjs';
import { findDraftFolder, saveDraft, validateReplaceDraft, retireDraft } from './drafts.mjs';
import { listMessages, searchFolder, monitorInbox } from './mailbox.mjs';
import { publicImapFailure } from './imap-diagnostics.mjs';
import { collectContacts, filterContacts } from './contacts.mjs';
import { manageFolder, validateFolderInput } from './folders.mjs';
import { scheduleMessage, listScheduled, sendDue, validateSendAt, stripHeaders } from './scheduled.mjs';
import { ManageSieveClient, loadSieve, saveSieve, validateSieveConfig } from './sieve.mjs';
import { indexableFolders } from './local-index.mjs';
import { hasReply, messageIdOf, snoozeMessages, validateWhen, wakeMessage } from './followups.mjs';

const CONTACTS_TTL_MS = 15 * 60 * 1000;
const PREVIEWABLE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/i;

export function registerMailRoutes(ctx) {
  const {
    api,
    withImap,
    errorResponse,
    cachedRead,
    requireAction,
    watchers,
    previewCache,
    listCache,
    detailCache,
    localIndex,
    followups,
    diagnostics
  } = ctx;
  const contactsCache = new Map();
  const sentRequests = new Map();

  // ------------------------------------------------------------ helpers
  async function knownContacts(account) {
    let entry = contactsCache.get(account.id);
    if (!entry || Date.now() - entry.at > CONTACTS_TTL_MS) {
      entry = {
        at: Date.now(),
        promise: withImap(
          client => collectContacts(client, { ownAddress: account.imap.user, sentFolder: account.sentFolder }),
          account
        )
      };
      contactsCache.set(account.id, entry);
      entry.promise.catch(() => contactsCache.delete(account.id));
    }
    return entry.promise;
  }
  async function davContactEmails() {
    try {
      return new Set((await ctx.davService.contacts()).contacts.flatMap(c => c.emails.map(e => e.value.toLowerCase())));
    } catch {
      return new Set();
    }
  }
  function readContext(account) {
    return {
      // Invitations are evaluated from the point of view of this mailbox.
      ownAddresses: ctx.accountAddresses(account),
      knownSender: async email => {
        if (!email) return null;
        if ((await davContactEmails()).has(email)) return true;
        const list = await Promise.race([
          knownContacts(account),
          new Promise(resolve => setTimeout(() => resolve(null), 1500))
        ]);
        return list ? list.some(c => c.email.toLowerCase() === email) : null;
      }
    };
  }
  const cryptoFor = () => ({ pgp: ctx.pgp, smime: ctx.smime });
  const inboxPath = folders => folders.find(f => f.path.toUpperCase() === 'INBOX')?.path || 'INBOX';

  async function inboxState(account, { fresh = false } = {}) {
    if (ctx.watch && fresh) await watchers.refresh(account.id);
    const cached = ctx.watch ? watchers.snapshot(account.id) : null;
    if (cached) return cached;
    const live = await withImap(client => monitorInbox(client, { previewCache, accountKey: account.id }), account);
    return { ...live, checkedAt: Date.now(), source: 'poll' };
  }

  /** Builds the final MIME (identity, HTML, optional PGP/S/MIME). */
  async function buildOutgoing(account, input, { keepBcc = false, headers = {} } = {}) {
    const from = ctx.fromFor(account, input.from);
    const security = input.security || {};
    if (security.method === 'password') {
      // The real message travels encrypted inside an HTML file; the visible mail only explains it.
      const { file } = buildProtectedFile(
        { from, subject: input.subject, html: input.html, text: input.text, attachments: input.attachments },
        security
      );
      const notice = protectedNotice({ sender: from.name || from.address, hint: security.hint });
      const outer = {
        ...input,
        text: notice.text,
        html: notice.html,
        attachments: [
          {
            filename: PROTECTED_FILENAME,
            content: Buffer.from(file, 'utf8'),
            contentType: 'text/html; charset=utf-8',
            contentDisposition: 'attachment'
          }
        ]
      };
      const raw = await composeRawEmail(from, outer, {
        headers: { ...headers, 'X-Levuvo-Protected': 'password' },
        keepBcc
      });
      return { raw, from };
    }
    let raw = await composeRawEmail(from, input, { headers, keepBcc });
    if (security.method && (security.sign || security.encrypt)) {
      const engine = security.method === 'pgp' ? ctx.pgp : ctx.smime;
      const base = keepBcc ? stripHeaders(raw, ['bcc']) : raw;
      raw = await engine.protect(base, {
        sign: security.sign,
        encrypt: security.encrypt,
        from: from.address,
        recipients: [...input.to, ...input.cc, ...input.bcc]
      });
      if (keepBcc && input.bcc.length) raw = Buffer.concat([Buffer.from(`Bcc: ${input.bcc.join(', ')}\r\n`), raw]);
    }
    return { raw, from };
  }

  // ------------------------------------------------------------ status, folders
  api.get('/api/status', async request => {
    const account = request.mailAccount;
    const writeEnabled = ctx.writeGloballyEnabled && account.imap.configured;
    return {
      mode: account.imap.configured ? 'configured' : 'setup-required',
      accountId: account.id,
      ...publicSendStatus(account.smtp, account.imap),
      readOnly: !writeEnabled,
      sender: account.smtp.configured ? account.imap.user : null,
      displayName: account.displayName || '',
      identities: [
        { email: account.imap.user, name: account.displayName || '', signatureHtml: account.signatureHtml || '' },
        ...(account.identities || [])
      ],
      writeEnabled,
      draftsEnabled: Boolean(ctx.draftsGloballyEnabled && account.imap.configured),
      signature: account.signature || '',
      signatureHtml: account.signatureHtml || '',
      auth: account.auth || 'password',
      push: watchers.status(account.id)
    };
  });
  api.get('/api/connection', async (request, reply) => {
    try {
      return await withImap(
        async client => ({
          connected: true,
          folderCount: (await client.list()).length,
          mailbox: request.mailAccount.imap.user
        }),
        request.mailAccount
      );
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/folders', async (request, reply) =>
    cachedRead(reply, listCache, `${request.mailAccount.id}|\u0000folders`, () =>
      withImap(async client => {
        let listed;
        try {
          listed = await client.list({ statusQuery: { unseen: true, messages: true } });
        } catch {
          listed = await client.list();
        }
        return {
          folders: listed
            .map(folder => ({
              path: folder.path,
              name: folderName(folder),
              specialUse: folder.specialUse || null,
              delimiter: folder.delimiter || null,
              parent: folder.parentPath || null,
              selectable: !folder.flags?.has('\\Noselect'),
              unseen: Number.isSafeInteger(folder.status?.unseen) ? folder.status.unseen : null,
              total: Number.isSafeInteger(folder.status?.messages) ? folder.status.messages : null
            }))
            .filter(folder => folder.selectable)
        };
      }, request.mailAccount)
    )
  );
  api.post('/api/folders/manage', { bodyLimit: 4096 }, async (request, reply) => {
    if (!ctx.writeGloballyEnabled || !requireAction(request, reply, 'mail-v1')) return;
    try {
      const input = validateFolderInput(request.body);
      const result = await withImap(client => manageFolder(client, input), request.mailAccount, {
        retryConnect: false
      });
      listCache.delete(`${request.mailAccount.id}|\u0000folders`);
      return result;
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.post('/api/folders/create-archive', { bodyLimit: 4096 }, async (request, reply) => {
    if (!ctx.writeGloballyEnabled || !requireAction(request, reply, 'mail-v1')) return;
    if (request.body?.confirm !== 'CREATE_ARCHIVE')
      return reply.code(400).send({ error: 'Archivordner muss ausdrücklich bestätigt werden.' });
    try {
      return await withImap(createArchiveFolder, request.mailAccount, { retryConnect: false });
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ lists & search
  api.get('/api/messages', async (request, reply) => {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    if (!validFolder(folder)) return reply.code(400).send({ error: 'Ungültiger Ordner.' });
    let beforeUid;
    try {
      beforeUid = cleanBeforeUid(request.query?.beforeUid);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    const limit = cleanLimit(request.query?.limit);
    const account = request.mailAccount;
    const key = beforeUid === null ? `${account.id}|${folder}` : null;
    return cachedRead(reply, listCache, key, () =>
      withImap(
        client => listMessages(client, folder, { limit, beforeUid, previewCache, accountKey: account.id }),
        account
      )
    );
  });
  api.get('/api/search', async (request, reply) => {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    if (!validFolder(folder)) return reply.code(400).send({ error: 'Ungültiger Ordner.' });
    try {
      const beforeUid = cleanBeforeUid(request.query?.beforeUid);
      return await withImap(
        client =>
          searchFolder(client, folder, request.query?.q, {
            limit: cleanLimit(request.query?.limit),
            beforeUid,
            previewCache,
            accountKey: request.mailAccount.id
          }),
        request.mailAccount
      );
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/inbox/monitor', async (request, reply) => {
    try {
      return await inboxState(request.mailAccount, { fresh: request.query?.fresh === '1' });
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/unified', async () => {
    const configured = ctx.accounts().filter(a => a.imap.configured);
    const results = await Promise.all(
      configured.map(async account => {
        try {
          return { account, state: await inboxState(account) };
        } catch (err) {
          return { account, error: publicImapFailure(err).error };
        }
      })
    );
    const messages = results.flatMap(({ account, state }) =>
      (state?.messages || []).map(m => ({ ...m, accountId: account.id, accountLabel: account.label }))
    );
    messages.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    return {
      accounts: results.map(r => ({
        id: r.account.id,
        label: r.account.label,
        healthy: !r.error,
        error: r.error || null
      })),
      messages: messages.slice(0, 150)
    };
  });

  // Encrypted local index: offline full-text search across all folders and accounts.
  api.get('/api/search/local', async (request, reply) => {
    const q = typeof request.query?.q === 'string' ? request.query.q : '';
    if (q.trim().length < 2 || q.length > 120) return reply.code(400).send({ error: 'Suche: 2 bis 120 Zeichen.' });
    const ids = request.query?.account ? [String(request.query.account)] : ctx.accounts().map(a => a.id);
    const known = new Set(ctx.accounts().map(a => a.id));
    const labels = Object.fromEntries(ctx.accounts().map(a => [a.id, a.label]));
    const hits = await localIndex.search(
      ids.filter(id => known.has(id)),
      q,
      { folder: typeof request.query?.folder === 'string' ? request.query.folder : null }
    );
    return {
      messages: hits.map(h => ({ ...h, accountLabel: labels[h.accountId] })),
      total: hits.length,
      source: 'local'
    };
  });
  api.get('/api/index/status', async () => {
    const out = [];
    for (const a of ctx.accounts()) out.push({ accountId: a.id, label: a.label, ...(await localIndex.status(a.id)) });
    return { enabled: ctx.settings.get().localIndex !== false, accounts: out };
  });
  api.post('/api/index/sync', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    void runIndexer(true);
    return { started: true };
  });
  api.post('/api/index/clear', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    for (const a of ctx.accounts()) await localIndex.clear(a.id);
    return { cleared: true };
  });

  // ------------------------------------------------------------ reading
  api.get('/api/messages/:uid', async (request, reply) => {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    if (!validFolder(folder) || !validUid(request.params.uid))
      return reply.code(400).send({ error: 'Ungültiger Ordner oder Nachrichten-ID.' });
    const account = request.mailAccount;
    const key = `${account.id}|${folder}|${request.params.uid}`;
    try {
      const loaded = await withImap(
        client =>
          loadParsedMessage(client, folder, Number(request.params.uid), {
            crypto: cryptoFor(),
            context: readContext(account)
          }),
        account
      );
      if (!loaded) return reply.code(404).send({ error: 'Nachricht nicht mehr vorhanden. Bitte aktualisieren.' });
      // Decrypted content is never cached for offline use.
      if (!loaded.detail.crypto?.encrypted) detailCache.set(key, { data: loaded.detail, at: Date.now() });
      return loaded.detail;
    } catch (err) {
      const cached = detailCache.get(key);
      if (cached && ['imap_temporarily_unavailable', 'imap_dns_failed'].includes(publicImapFailure(err).code))
        return { ...cached.data, stale: true, cachedAt: cached.at };
      if (['imap_temporarily_unavailable', 'imap_dns_failed'].includes(publicImapFailure(err).code)) {
        const local = await localIndex.text(account.id, folder, request.params.uid);
        if (local) {
          return {
            uid: Number(request.params.uid),
            folder,
            from: [{ name: local.fromName, email: local.fromEmail }],
            to: [],
            cc: [],
            replyTo: [],
            subject: local.subject,
            date: local.date,
            text: `${local.text}${local.text.length >= 2990 ? ' …' : ''}`,
            html: '',
            attachments: [],
            textTruncated: true,
            htmlTruncated: false,
            readOnly: true,
            stale: true,
            offlineIndex: true
          };
        }
      }
      return errorResponse(reply, err);
    }
  });
  async function attachment(request, reply, inline) {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    const { uid, index } = request.params;
    if (!validFolder(folder) || !validUid(uid) || !validAttachmentIndex(index))
      return reply.code(400).send({ error: 'Ungültige Anhang-Anfrage.' });
    try {
      return await withImap(async client => {
        const loaded = await loadParsedMessage(client, folder, Number(uid), { crypto: cryptoFor() });
        if (!loaded) return reply.code(404).send({ error: 'Nachricht nicht gefunden.' });
        const info = loaded.detail.attachments[Number(index)];
        const att = loaded.parsed.attachments[Number(index)];
        if (!info || !att) return reply.code(404).send({ error: 'Anhang nicht gefunden.' });
        const content = attachmentBytes(att);
        if (inline) {
          const type = String(info.mimeType || '').toLowerCase();
          if (!PREVIEWABLE.test(type))
            return reply.code(415).send({ error: 'Für diesen Dateityp gibt es keine Vorschau.' });
          reply.headers({
            'Content-Type': type === 'text/plain' ? 'text/plain; charset=utf-8' : type,
            'Content-Disposition': `inline; filename="preview"; filename*=UTF-8''${encodeURIComponent(info.filename)}`,
            // PDFs open in Chromium's built-in viewer (a stricter CSP would block it; PDF
            // scripting is not available there). Everything else is sandboxed without scripts.
            'Content-Security-Policy':
              type === 'application/pdf'
                ? "frame-ancestors 'self'"
                : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox; frame-ancestors 'self'",
            'X-Frame-Options': 'SAMEORIGIN'
          });
        } else {
          reply.headers(downloadHeaders(info.filename));
        }
        reply.header('Content-Length', content.length);
        return reply.send(content);
      }, request.mailAccount);
    } catch (err) {
      return errorResponse(reply, err);
    }
  }
  api.get('/api/messages/:uid/attachments/:index', (request, reply) =>
    attachment(request, reply, request.query?.inline === '1')
  );
  api.get('/api/thread', async (request, reply) => {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    if (!validFolder(folder) || !validUid(String(request.query?.uid || '')))
      return reply.code(400).send({ error: 'Ungültige Anfrage.' });
    try {
      return await withImap(
        client =>
          loadThread(client, folder, Number(request.query.uid), { previewCache, accountKey: request.mailAccount.id }),
        request.mailAccount
      );
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/messages/:uid/raw', async (request, reply) => {
    const folder = typeof request.query?.folder === 'string' ? request.query.folder : 'INBOX';
    if (!validFolder(folder) || !validUid(request.params.uid))
      return reply.code(400).send({ error: 'Ungültige Anfrage.' });
    try {
      return await withImap(async client => {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const msg = await client.fetchOne(
            String(request.params.uid),
            { source: true, envelope: true },
            { uid: true }
          );
          if (!msg?.source) return reply.code(404).send({ error: 'Nachricht nicht gefunden.' });
          const name = `${
            String(msg.envelope?.subject || 'Nachricht')
              .replace(/[^\p{L}\p{N} ._-]+/gu, '')
              .trim()
              .slice(0, 80) || 'Nachricht'
          }.eml`;
          reply.headers({ ...downloadHeaders(name), 'Content-Type': 'message/rfc822' });
          return reply.send(msg.source);
        } finally {
          lock.release();
        }
      }, request.mailAccount);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ address suggestions
  api.get('/api/contacts', async (request, reply) => {
    const q = typeof request.query?.q === 'string' ? request.query.q : '';
    if (q.length > 120) return reply.code(400).send({ error: 'Suchbegriff zu lang.' });
    let fromDav = [];
    try {
      fromDav = (await ctx.davService.contacts()).contacts.flatMap(c =>
        c.emails.map(e => ({ email: e.value, name: c.name, score: 100 }))
      );
    } catch {
      /* no DAV account */
    }
    let fromMail = [];
    try {
      fromMail = await knownContacts(request.mailAccount);
    } catch {
      /* offline */
    }
    const seen = new Set();
    const merged = [...fromDav, ...fromMail].filter(c => {
      const k = c.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { contacts: filterContacts(merged, q) };
  });

  // ------------------------------------------------------------ drafts
  api.get('/api/drafts/status', async (request, reply) => {
    try {
      return await withImap(async client => {
        const folder = findDraftFolder(await client.list(), request.mailAccount.draftsFolder);
        return {
          enabled: ctx.draftsGloballyEnabled,
          folder: folder?.path || null,
          supported: client.capabilities.has('UIDPLUS')
        };
      }, request.mailAccount);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.post('/api/drafts/save', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    if (!ctx.draftsGloballyEnabled || !request.mailAccount.imap.configured)
      return reply
        .code(403)
        .send({ error: 'Entwürfe sind in dieser Sitzung nicht verfügbar.', code: 'draft_disabled' });
    if (!requireAction(request, reply, 'draft-v1')) return;
    try {
      const from = ctx.fromFor(request.mailAccount, request.body?.from);
      return await withImap(
        client => saveDraft(client, from, request.body, request.mailAccount.draftsFolder),
        request.mailAccount,
        { retryConnect: false }
      );
    } catch (err) {
      if (err.statusCode >= 400 && err.statusCode < 500)
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      return reply.code(502).send({
        error: 'Speicherstatus unklar. Bitte den Entwürfe-Ordner prüfen und nicht sofort erneut speichern.',
        code: 'draft_save_uncertain'
      });
    }
  });

  // ------------------------------------------------------------ actions
  function writeAllowed(request, reply) {
    if (!ctx.writeGloballyEnabled || !request.mailAccount.imap.configured) {
      reply.code(403).send({ error: 'Postfach-Änderungen sind in dieser Sitzung nicht freigegeben.' });
      return false;
    }
    return requireAction(request, reply, 'mail-v1');
  }
  function actionError(reply, err) {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)
      return reply.code(err.statusCode).send({ error: err.message, code: err.code || 'invalid_request' });
    return reply.code(502).send({
      error: 'Änderung auf dem Mailserver fehlgeschlagen. Bitte Ordner aktualisieren und erneut prüfen.',
      code: 'imap_write_failed'
    });
  }
  async function runAction(request, reply, input) {
    try {
      const result = await withImap(client => performMessageAction(client, input), request.mailAccount, {
        retryConnect: false
      });
      for (const uid of input.uids) detailCache.delete(`${request.mailAccount.id}|${input.folder}|${uid}`);
      listCache.delete(`${request.mailAccount.id}|\u0000folders`);
      if (ctx.watch) void watchers.refresh(request.mailAccount.id);
      return result;
    } catch (err) {
      return actionError(reply, err);
    }
  }
  api.post('/api/messages/:uid/action', { bodyLimit: 4096 }, async (request, reply) => {
    if (!writeAllowed(request, reply)) return;
    let input;
    try {
      input = validateActionInput(request.params.uid, request.body);
    } catch (err) {
      return actionError(reply, err);
    }
    return runAction(request, reply, input);
  });
  api.post('/api/messages/batch-action', { bodyLimit: 32 * 1024 }, async (request, reply) => {
    if (!writeAllowed(request, reply)) return;
    let input;
    try {
      input = validateBatchInput(request.body);
    } catch (err) {
      return actionError(reply, err);
    }
    return runAction(request, reply, input);
  });

  // ------------------------------------------------------------ sending
  api.post('/api/messages/send', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const account = request.mailAccount;
    if (!account.imap.configured || !account.smtp.configured || !account.smtp.enabled)
      return reply.code(403).send({ error: 'Versand ist in dieser Sitzung nicht freigegeben.' });
    if (request.headers['x-levuvo-action'] !== 'send-v1')
      return reply.code(403).send({ error: 'Lokaler Versand nicht autorisiert.' });
    let input;
    let replaceDraft;
    let followUp;
    try {
      input = validateSendPayload(request.body);
      ctx.fromFor(account, input.from);
      replaceDraft = validateReplaceDraft(request.body?.replaceDraft);
      followUp = request.body?.followUp ? validateWhen(request.body.followUp) : null;
    } catch (err) {
      return reply.code(err.statusCode || 400).send({ error: err.message, code: err.code });
    }
    // Each request ID reaches SMTP at most once; after a timeout delivery is unknown.
    const key = accountScopedRequestKey(account, input.requestId);
    if (!sentRequests.has(key)) {
      const operation = (async () => {
        let raw;
        try {
          ({ raw } = await buildOutgoing(account, input));
        } catch (err) {
          return { status: err.statusCode || 400, error: err.message, code: err.code };
        }
        let submitted;
        try {
          const smtp = await ctx.smtpConfigFor(account);
          submitted = await submitEmail(smtp, input, raw, ctx.smtpFactory(smtp));
        } catch {
          diagnostics.record('smtp', 'send_unconfirmed');
          return {
            status: 502,
            error:
              'SMTP-Versand konnte nicht bestätigt werden. Vor einem erneuten Versuch „Gesendet“ bzw. den Empfänger prüfen; die Nachricht könnte bereits versendet worden sein.'
          };
        }
        const sentCopy = await appendToSent(
          fn => withImap(fn, account, { retryConnect: false }),
          raw,
          account.sentFolder
        );
        contactsCache.delete(account.id);
        const retired = replaceDraft
          ? await withImap(client => retireDraft(client, replaceDraft, account.draftsFolder), account, {
              retryConnect: false
            }).catch(() => ({ removed: false }))
          : { removed: false };
        if (replaceDraft) listCache.deleteWhere(k => k.startsWith(`${account.id}|`));
        const messageId = messageIdOf(raw);
        if (followUp && messageId)
          await followups
            .addFollowup({
              accountId: account.id,
              messageId,
              subject: input.subject,
              to: [...input.to, ...input.cc],
              due: followUp
            })
            .catch(() => {});
        return {
          status: 200,
          body: {
            followUp: Boolean(followUp && messageId),
            draftRemoved: retired.removed,
            sent: submitted.accepted.length > 0,
            acceptedCount: submitted.accepted.length,
            rejectedCount: submitted.rejected.length,
            savedToSent: sentCopy.saved,
            sentFolder: sentCopy.folder,
            sentCopyError: sentCopy.reason,
            partial: submitted.rejected.length > 0
          }
        };
      })().catch(() => ({
        status: 502,
        error: 'Nachricht konnte nicht verarbeitet werden. Es wurde kein weiterer Versand ausgelöst.'
      }));
      sentRequests.set(key, operation);
      if (sentRequests.size > 200) sentRequests.delete(sentRequests.keys().next().value);
    }
    const result = await sentRequests.get(key);
    if (result.error) {
      if (result.status < 500) sentRequests.delete(key); // nothing was sent: the user may correct and retry
      return reply.code(result.status).send({ error: result.error, code: result.code });
    }
    return reply.code(result.status).send(result.body);
  });

  // "Später senden": stored in Drafts; sent by the scheduler below.
  api.post('/api/messages/schedule', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    const account = request.mailAccount;
    if (!account.smtp.configured || !account.smtp.enabled)
      return reply.code(403).send({ error: 'Versand ist in dieser Sitzung nicht freigegeben.' });
    if (request.headers['x-levuvo-action'] !== 'send-v1')
      return reply.code(403).send({ error: 'Lokaler Versand nicht autorisiert.' });
    try {
      const input = validateSendPayload(request.body);
      ctx.fromFor(account, input.from);
      const replaceDraft = validateReplaceDraft(request.body?.replaceDraft);
      const sendAt = validateSendAt(request.body?.sendAt);
      const followUp = request.body?.followUp ? validateWhen(request.body.followUp, sendAt.getTime()) : null;
      const { raw } = await buildOutgoing(account, input, {
        keepBcc: true,
        headers: { 'X-Levuvo-Send-At': sendAt.toISOString(), 'X-Levuvo-Draft-ID': input.requestId }
      });
      const stored = await withImap(client => scheduleMessage(client, raw, account.draftsFolder), account, {
        retryConnect: false
      });
      nextSchedulerRun = Math.min(nextSchedulerRun, sendAt.getTime());
      const retired = replaceDraft
        ? await withImap(client => retireDraft(client, replaceDraft, account.draftsFolder), account, {
            retryConnect: false
          }).catch(() => ({ removed: false }))
        : { removed: false };
      listCache.deleteWhere(k => k.startsWith(`${account.id}|`));
      const messageId = messageIdOf(raw);
      if (followUp && messageId)
        await followups.addFollowup({
          accountId: account.id,
          messageId,
          subject: input.subject,
          to: [...input.to, ...input.cc],
          due: followUp
        });
      return { scheduled: true, sendAt: sendAt.toISOString(), draftRemoved: retired.removed, ...stored };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/scheduled', async (request, reply) => {
    try {
      return await withImap(client => listScheduled(client, request.mailAccount.draftsFolder), request.mailAccount);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ password-protected messages
  const protectedAttempts = new Map(); // `${account}|${folder}|${uid}` → { count, until }
  api.post('/api/messages/protected/open', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    const account = request.mailAccount;
    const { folder, uid, password } = request.body || {};
    try {
      if (!validFolder(folder) || !validUid(String(uid)) || typeof password !== 'string' || password.length > 200)
        throw Object.assign(new Error('Ungültige Anfrage.'), { statusCode: 400 });
      const key = `${account.id}|${folder}|${uid}`;
      const attempt = protectedAttempts.get(key);
      if (attempt && attempt.until > Date.now())
        return reply.code(429).send({ error: 'Zu viele Versuche. Bitte eine Minute warten.', code: 'protected_wait' });
      const loaded = await withImap(client => loadParsedMessage(client, folder, Number(uid)), account);
      const found = loaded ? findProtectedBox(loaded.parsed.attachments) : null;
      if (!found)
        throw Object.assign(new Error('Diese Nachricht ist keine geschützte Nachricht.'), {
          statusCode: 404,
          code: 'protected_missing'
        });
      let message;
      try {
        message = openPayload(found.box, password);
      } catch (err) {
        const count = (attempt?.count || 0) + 1;
        protectedAttempts.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
        throw err;
      }
      protectedAttempts.delete(key);
      return {
        subject: String(message.subject || ''),
        from: String(message.from || ''),
        date: message.date || null,
        html: String(message.html || ''),
        text: String(message.text || ''),
        attachments: (message.attachments || []).map(a => ({
          name: String(a.name || 'Anhang'),
          type: String(a.type || 'application/octet-stream'),
          size: Math.floor((String(a.data || '').length * 3) / 4),
          data: String(a.data || '')
        }))
      };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ newsletters: unsubscribe
  api.post('/api/messages/unsubscribe', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    const account = request.mailAccount;
    const { folder, uid } = request.body || {};
    try {
      if (!validFolder(folder) || !validUid(String(uid)))
        throw Object.assign(new Error('Ungültige Nachricht.'), { statusCode: 400 });
      const loaded = await withImap(client => loadParsedMessage(client, folder, Number(uid)), account);
      const info = loaded ? parseUnsubscribe(loaded.parsed.headers) : null;
      if (!info)
        throw Object.assign(new Error('Diese Nachricht bietet keine Abmeldung an.'), {
          statusCode: 404,
          code: 'unsubscribe_missing'
        });
      if (info.oneClick) {
        await oneClickUnsubscribe(info.http, { fetchImpl: ctx.fetchImpl });
        diagnostics.record('unsubscribe', 'one-click');
        return { done: true, method: 'one-click' };
      }
      if (info.mailto) {
        if (!account.smtp.configured || !account.smtp.enabled)
          return reply.code(403).send({ error: 'Versand ist in dieser Sitzung nicht freigegeben.' });
        const input = {
          to: [info.mailto.to],
          cc: [],
          bcc: [],
          subject: info.mailto.subject,
          text: info.mailto.body,
          attachments: []
        };
        const { raw } = await buildOutgoing(account, input);
        const smtp = await ctx.smtpConfigFor(account);
        await submitEmail(smtp, input, raw, ctx.smtpFactory(smtp));
        diagnostics.record('unsubscribe', 'mail');
        return { done: true, method: 'mail', to: info.mailto.to };
      }
      return { done: false, method: 'web', url: info.http };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ snooze & follow-up
  api.post('/api/messages/snooze', { bodyLimit: 32 * 1024 }, async (request, reply) => {
    if (!writeAllowed(request, reply)) return;
    const account = request.mailAccount;
    try {
      const folder = request.body?.folder;
      const uids = Array.isArray(request.body?.uids) ? [...new Set(request.body.uids.map(String))] : [];
      if (!validFolder(folder) || !uids.length || uids.length > 200 || !uids.every(validUid))
        throw Object.assign(new Error('Ungültige Anfrage.'), { statusCode: 400 });
      const until = validateWhen(request.body?.until);
      const result = await withImap(client => snoozeMessages(client, { folder, uids }), account, {
        retryConnect: false
      });
      const added = await followups.addSnoozed(account.id, folder, result, until);
      listCache.deleteWhere(k => k.startsWith(`${account.id}|`));
      if (ctx.watch) void watchers.refresh(account.id);
      return { snoozed: result.items.length, until, folder: result.folder, ids: added.map(a => a.id) };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/snoozed', async request => ({
    items: followups.snoozed(request.mailAccount.id).sort((a, b) => a.until.localeCompare(b.until))
  }));
  api.post('/api/snoozed/wake', { bodyLimit: 1024 }, async (request, reply) => {
    if (!writeAllowed(request, reply)) return;
    const entry = followups.snoozed(request.mailAccount.id).find(s => s.id === request.body?.id);
    if (!entry) return reply.code(404).send({ error: 'Eintrag nicht gefunden.' });
    try {
      const result = await withImap(client => wakeMessage(client, entry), request.mailAccount, { retryConnect: false });
      await followups.removeSnoozed(entry.id);
      listCache.deleteWhere(k => k.startsWith(`${request.mailAccount.id}|`));
      return result;
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/followups', async () => {
    const labels = Object.fromEntries(ctx.accounts().map(a => [a.id, a.label]));
    return {
      items: followups
        .followups()
        .filter(f => labels[f.accountId])
        .map(f => ({ ...f, accountLabel: labels[f.accountId] }))
        .sort((a, b) => a.due.localeCompare(b.due))
    };
  });
  api.post('/api/followups/remind', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    try {
      const due = validateWhen(request.body?.due);
      await followups.updateFollowup(String(request.body?.id || ''), { due, state: 'waiting' });
      return { ok: true, due };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.post('/api/followups/dismiss', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    await followups.removeFollowup(String(request.body?.id || ''));
    return { ok: true };
  });

  async function runFollowups() {
    const now = Date.now();
    for (const account of ctx.accounts().filter(a => a.imap.configured)) {
      for (const entry of followups.snoozed(account.id).filter(s => Date.parse(s.until) <= now)) {
        try {
          const result = await withImap(client => wakeMessage(client, entry), account, { retryConnect: false });
          // Gone (e.g. deleted in webmail): nothing to bring back.
          if (result.woke || result.reason === 'message_missing') await followups.removeSnoozed(entry.id);
          diagnostics.record('snooze', result.woke ? 'woke' : result.reason);
          listCache.deleteWhere(k => k.startsWith(`${account.id}|`));
          if (ctx.watch) void watchers.refresh(account.id);
        } catch {
          diagnostics.record('snooze', 'wake_failed');
        }
      }
      for (const entry of followups
        .followups(account.id)
        .filter(f => f.state === 'waiting' && Date.parse(f.due) <= now)) {
        try {
          const answered = await withImap(client => hasReply(client, entry.messageId), account, {
            retryConnect: false
          });
          if (answered) await followups.removeFollowup(entry.id);
          else await followups.updateFollowup(entry.id, { state: 'due' });
        } catch {
          diagnostics.record('followup', 'check_failed');
        }
      }
    }
  }
  ctx.runFollowups = runFollowups;

  // ------------------------------------------------------------ filters & vacation (Sieve)
  async function withSieve(account, fn) {
    if (account.auth === 'oauth2')
      throw Object.assign(new Error('Filterregeln sind für dieses Konto nur im Webmail des Anbieters verfügbar.'), {
        statusCode: 409,
        code: 'sieve_unavailable'
      });
    const imap = await ctx.imapConfig(account);
    let client;
    try {
      client = await new ManageSieveClient({
        host: account.sieve?.host || imap.host,
        port: account.sieve?.port || 4190,
        user: imap.user,
        password: imap.password
      }).connect();
    } catch (err) {
      if (err.code === 'sieve_auth_failed') throw Object.assign(err, { statusCode: 422 });
      throw Object.assign(
        new Error('Der Filterserver (ManageSieve) ist nicht erreichbar. Dein Anbieter bietet ihn eventuell nicht an.'),
        { statusCode: 409, code: 'sieve_unavailable' }
      );
    }
    try {
      return await fn(client);
    } finally {
      await client.logout();
    }
  }
  api.get('/api/sieve', async (request, reply) => {
    try {
      const result = await withSieve(request.mailAccount, client => loadSieve(client));
      return result;
    } catch (err) {
      if (err.code === 'sieve_unavailable') return { available: false, reason: err.message };
      return errorResponse(reply, err);
    }
  });
  api.post('/api/sieve', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    const account = request.mailAccount;
    try {
      const folders = await withImap(client => client.list(), account);
      const config = validateSieveConfig(request.body?.config, { folderExists: p => folders.some(f => f.path === p) });
      const trash = findSpecialFolder(folders, '\\Trash')?.path || '';
      return await withSieve(account, client =>
        saveSieve(client, config, { trashFolder: trash, replaceForeign: request.body?.replaceForeign === true })
      );
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ------------------------------------------------------------ background jobs
  let nextSchedulerRun = 0;
  let indexing = false;
  async function runScheduler() {
    if (Date.now() < nextSchedulerRun) return;
    let next = Date.now() + 10 * 60 * 1000;
    for (const account of ctx.accounts().filter(a => a.imap.configured && a.smtp.configured)) {
      try {
        const result = await withImap(
          client =>
            sendDue(client, {
              preferredDrafts: account.draftsFolder,
              submit: async (recipients, raw) => {
                const smtp = await ctx.smtpConfigFor(account);
                await submitEmail(smtp, { to: recipients, cc: [], bcc: [] }, raw, ctx.smtpFactory(smtp));
              },
              saveSent: raw =>
                appendToSent(fn => withImap(fn, account, { retryConnect: false }), raw, account.sentFolder)
            }),
          account,
          { retryConnect: false }
        );
        for (const r of result.results) diagnostics.record('scheduled', r.sent ? 'sent' : 'failed');
        if (result.next) next = Math.min(next, Date.parse(result.next));
      } catch {
        diagnostics.record('scheduled', 'check_failed');
      }
    }
    nextSchedulerRun = next;
  }
  async function runIndexer(force = false) {
    if (indexing || ctx.settings.get().localIndex === false) return;
    indexing = true;
    try {
      for (const account of ctx.accounts().filter(a => a.imap.configured)) {
        try {
          await withImap(
            async client =>
              localIndex.sync(client, account.id, indexableFolders(await client.list()), {
                budget: force ? 5000 : 1500
              }),
            account
          );
        } catch {
          diagnostics.record('index', 'sync_failed');
        }
      }
    } finally {
      indexing = false;
    }
  }
  ctx.startBackgroundJobs = () => {
    setTimeout(() => void runIndexer(), 60_000).unref?.();
    setTimeout(() => void runScheduler(), 15_000).unref?.();
    setTimeout(() => void runFollowups(), 10_000).unref?.();
    return [
      setInterval(() => void runScheduler(), 30_000),
      setInterval(() => void runFollowups(), 30_000),
      setInterval(() => void runIndexer(), 15 * 60_000)
    ];
  };
  ctx.runScheduler = runScheduler;
  ctx.runIndexer = runIndexer;
  ctx.inboxPath = inboxPath;
  ctx.publicAccounts = () => publicAccounts(ctx.accounts());
  ctx.findSentFolder = findSentFolder;
}
