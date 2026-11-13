// OpenPGP / S/MIME key management, diagnostics and app-wide settings.
import { validFolder, validUid, attachmentBytes } from './message-utils.mjs';
import { loadParsedMessage } from './message-service.mjs';

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function registerCryptoRoutes(ctx) {
  const { api, pgp, smime, requireAction, errorResponse, diagnostics, settings } = ctx;
  const guard = (route, handler, limit = 256 * 1024) =>
    api.post(route, { bodyLimit: limit }, async (request, reply) => {
      if (!requireAction(request, reply, 'crypto-v1')) return;
      try {
        return await handler(request, reply);
      } catch (err) {
        return errorResponse(reply, err);
      }
    });

  api.get('/api/crypto', async () => ({
    vaultAvailable: ctx.accountManager.vaultAvailable,
    pgp: pgp.list(),
    smime: smime.list()
  }));
  guard('/api/crypto/pgp/generate', async request => {
    const { name, email, passphrase } = request.body || {};
    if (!ctx.ownAddresses().includes(String(email || '').toLowerCase()))
      throw fail('Schlüssel nur für eigene Absenderadressen erzeugen.', 'pgp_email_unknown');
    return pgp.generate({ name, email: String(email).toLowerCase(), passphrase });
  });
  guard('/api/crypto/pgp/import', async request =>
    pgp.importKey(request.body?.armored, request.body?.passphrase || '')
  );
  guard('/api/crypto/pgp/unlock', async request =>
    pgp.unlock(String(request.body?.fingerprint || ''), String(request.body?.passphrase || ''))
  );
  guard('/api/crypto/pgp/lock', async () => {
    pgp.lock();
    return { locked: true };
  });
  guard('/api/crypto/pgp/remove', async request => {
    if (request.body?.confirm !== 'REMOVE_KEY') throw fail('Entfernen muss bestätigt werden.', 'pgp_invalid');
    await pgp.remove(String(request.body?.fingerprint || ''));
    return { removed: true };
  });
  api.get('/api/crypto/pgp/export', async (request, reply) => {
    try {
      const armored = pgp.exportPublic(String(request.query?.fingerprint || ''));
      reply.headers({
        'Content-Type': 'application/pgp-keys',
        'Content-Disposition': 'attachment; filename="public-key.asc"'
      });
      return armored;
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  guard('/api/crypto/pgp/missing', async request => ({
    missing: await pgp.missingKeys((request.body?.emails || []).slice(0, 50))
  }));
  guard('/api/crypto/smime/missing', async request => ({
    missing: smime.missingCertificates((request.body?.emails || []).slice(0, 50)),
    own: smime.hasOwn(request.body?.from)
  }));
  guard(
    '/api/crypto/smime/import-p12',
    async request => {
      const b64 = String(request.body?.p12 || '');
      if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw fail('Ungültige Datei.', 'smime_p12_invalid');
      return smime.importP12(Buffer.from(b64, 'base64'), String(request.body?.password || ''));
    },
    2 * 1024 * 1024
  );
  guard('/api/crypto/smime/import-cert', async request =>
    smime.importCertificate(String(request.body?.pem || ''), { trust: request.body?.trust === true })
  );
  guard('/api/crypto/smime/remove', async request => {
    if (request.body?.confirm !== 'REMOVE_KEY') throw fail('Entfernen muss bestätigt werden.', 'smime_invalid');
    await smime.remove(String(request.body?.id || ''));
    return { removed: true };
  });
  // Public key attached to a mail (application/pgp-keys) → import after user confirmation.
  api.post('/api/crypto/pgp/import-from-message', { bodyLimit: 4096 }, async (request, reply) => {
    if (!requireAction(request, reply, 'crypto-v1')) return;
    const { folder, uid, index, account } = request.body || {};
    const mailAccount = ctx.accounts().find(a => a.id === account);
    if (!mailAccount || !validFolder(folder) || !validUid(String(uid)) || !Number.isInteger(index))
      return reply.code(400).send({ error: 'Ungültige Anfrage.' });
    try {
      const loaded = await ctx.withImap(client => loadParsedMessage(client, folder, Number(uid)), mailAccount);
      const att = loaded?.parsed.attachments[index];
      if (!att) return reply.code(404).send({ error: 'Anhang nicht gefunden.' });
      const armored = attachmentBytes(att).toString('utf8');
      if (armored.includes('PRIVATE KEY'))
        throw fail('Private Schlüssel werden aus E-Mails nicht übernommen.', 'pgp_key_invalid');
      return await pgp.importKey(armored);
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  // ---------------------------------------------------------------- diagnostics & settings
  api.get('/api/diagnostics', async (_request, reply) => {
    const report = diagnostics.report({
      accounts: ctx.accounts().length,
      davAccounts: ctx.davStore.list().length,
      push: ctx.accounts().map(a => ({ healthy: ctx.watchers.status(a.id)?.healthy ?? null })),
      vault: ctx.accountManager.vaultAvailable
    });
    reply.header('Content-Disposition', 'attachment; filename="levuvo-mail-diagnose.json"');
    return report;
  });
  api.post('/api/diagnostics/client-error', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    diagnostics.record(
      'ui',
      String(request.body?.code || 'error')
        .replace(/[^a-z0-9_.-]/gi, '')
        .slice(0, 60) || 'error'
    );
    return { ok: true };
  });
  // ---------------------------------------------------------------- text templates
  api.get('/api/templates', async () => ({ templates: ctx.templates.list() }));
  api.post('/api/templates/save', { bodyLimit: 512 * 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    try {
      return { template: await ctx.templates.save(request.body || {}) };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.post('/api/templates/delete', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    await ctx.templates.remove(String(request.body?.id || ''));
    return { ok: true };
  });
  api.get('/api/app-settings', async () => settings.get());
  api.post('/api/app-settings', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    const b = request.body || {};
    const next = { ...settings.get() };
    if (typeof b.crashReports === 'boolean') next.crashReports = b.crashReports;
    if (typeof b.localIndex === 'boolean') next.localIndex = b.localIndex;
    await settings.save(next);
    if (next.localIndex === false) for (const a of ctx.accounts()) await ctx.localIndex.clear(a.id);
    return next;
  });
}
