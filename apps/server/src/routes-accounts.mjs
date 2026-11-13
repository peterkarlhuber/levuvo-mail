// Mail account management (password and OAuth sign-in).
import { publicAccounts } from './accounts.mjs';
import { verifyAccountConfig } from './account-verify.mjs';
import { callbackPage } from './oauth.mjs';

export function registerAccountRoutes(ctx) {
  const { api, accountManager, oauth, refreshAccounts, requireAction, imapFactory, smtpFactory } = ctx;

  api.get('/api/accounts', async () => ({ accounts: publicAccounts(ctx.accounts()) }));
  api.get('/api/accounts/management', async () => ({
    vaultAvailable: accountManager.vaultAvailable,
    accounts: accountManager.listManagement(),
    oauthProviders: oauth.providers(),
    source: 'os-keychain'
  }));

  function accountError(reply, err) {
    if (err.statusCode >= 400 && err.statusCode < 500) {
      return reply
        .code(err.statusCode)
        .send({ error: err.message, code: err.code, field: err.field, retryable: err.retryable === true });
    }
    return reply.code(503).send({
      error:
        'Der Schlüsselbund oder die lokale Kontodatei ist nicht verfügbar. Es wurde nichts unverschlüsselt gespeichert.'
    });
  }
  const manage = (route, limit, handler) =>
    api.post(route, { bodyLimit: limit }, async (request, reply) => {
      if (!requireAction(request, reply, 'accounts-v1')) return;
      try {
        return await handler(request, reply);
      } catch (err) {
        return accountError(reply, err);
      }
    });

  manage('/api/accounts/verify', 400 * 1024, async request => accountManager.verifyInput(request.body));
  manage('/api/accounts/create', 1024 * 1024, async (request, reply) => {
    const account = await accountManager.create(request.body);
    refreshAccounts();
    return reply.code(201).send({ account });
  });
  manage('/api/accounts/update', 4 * 1024 * 1024, async request => {
    const account = await accountManager.update(request.body?.id, request.body);
    refreshAccounts();
    return { account };
  });
  manage('/api/accounts/adopt', 1024, async (request, reply) => {
    if (request.body?.confirm !== 'MIGRATE_TO_KEYCHAIN')
      return reply.code(400).send({ error: 'Übernahme muss bestätigt werden.' });
    const account = await accountManager.adopt(request.body.id);
    refreshAccounts();
    return { account };
  });
  manage('/api/accounts/remove', 1024, async (request, reply) => {
    if (request.body?.confirm !== 'REMOVE_LOCAL_ACCOUNT')
      return reply.code(400).send({ error: 'Entfernen muss ausdrücklich bestätigt werden.' });
    const result = await accountManager.remove(request.body.id);
    oauth.forget(request.body.id);
    await ctx.localIndex.clear(request.body.id);
    await ctx.followups.forgetAccount(request.body.id);
    refreshAccounts();
    return result;
  });

  // ---- OAuth 2.0 (Microsoft 365 / Google) -------------------------------------
  api.get('/api/oauth/providers', async () => ({ providers: oauth.providers() }));
  manage('/api/oauth/start', 1024, async request => {
    const redirectUri = `http://127.0.0.1:${ctx.port()}/oauth/callback`;
    const relink = request.body?.accountId ? String(request.body.accountId) : null;
    if (relink) {
      const account = ctx.accounts().find(a => a.id === relink);
      if (!account || account.auth !== 'oauth2' || account.imap?.oauth !== request.body?.provider)
        throw Object.assign(new Error('Konto nicht gefunden.'), { statusCode: 404, code: 'oauth_account_missing' });
    }
    return oauth.start(String(request.body?.provider || ''), redirectUri, relink);
  });
  api.get('/api/oauth/status', async request => oauth.status(String(request.query?.state || '')));

  api.get('/oauth/callback', async (request, reply) => {
    const { state, code, error } = request.query || {};
    reply
      .type('text/html; charset=utf-8')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (error) {
      oauth.setStatus(String(state || ''), { status: 'failed', error: 'Die Anmeldung wurde abgebrochen.' });
      return callbackPage(false, 'Die Anmeldung wurde abgebrochen.');
    }
    try {
      const result = await oauth.complete(String(state || ''), String(code || ''));
      const provider = oauth.provider(result.provider);
      if (result.relinkAccountId) {
        // Renewed consent for an existing account: same mailbox required, token replaced.
        const existing = ctx.accounts().find(a => a.id === result.relinkAccountId);
        if (!existing || String(existing.imap?.user || '').toLowerCase() !== result.email)
          throw Object.assign(new Error('Bitte mit demselben Konto anmelden.'), { code: 'oauth_wrong_account' });
        accountManager.setSecret(existing.id, 'oauth', result.refreshToken);
        oauth.forget(existing.id);
        oauth.remember(existing.id, result.accessToken, result.expiresIn);
        ctx.cloud?.reset(existing.id);
        oauth.setStatus(String(state), { status: 'done', accountId: existing.id });
        refreshAccounts();
        return callbackPage(true, `${result.email}: Kalender und Kontakte sind freigegeben.`);
      }
      const account = await accountManager.createOAuth({
        provider: result.provider,
        email: result.email,
        refreshToken: result.refreshToken,
        label: result.email,
        imapHost: provider.imapHost,
        smtpHost: provider.smtpHost,
        smtpPort: provider.smtpPort,
        // Proves that IMAP and SMTP accept the token before the account is stored.
        verifyToken: item =>
          verifyAccountConfig(
            {
              imap: { host: item.imapHost, port: item.imapPort, user: item.user, accessToken: result.accessToken },
              smtp: { host: item.smtpHost, port: item.smtpPort, user: item.smtpUser, accessToken: result.accessToken }
            },
            { imapFactory, smtpFactory }
          )
      });
      oauth.remember(account.id, result.accessToken, result.expiresIn);
      oauth.setStatus(String(state), { status: 'done', accountId: account.id });
      refreshAccounts();
      return callbackPage(true, `${result.email} wurde verbunden.`);
    } catch (err) {
      oauth.setStatus(String(state || ''), { status: 'failed', error: err.message });
      ctx.diagnostics.record('oauth', err.code || 'failed');
      return callbackPage(false, err.message);
    }
  });
}
