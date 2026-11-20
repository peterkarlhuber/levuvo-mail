// OAuth 2.0 sign-in (Authorization Code + PKCE, loopback redirect) for Microsoft 365
// and Google. Only the refresh token is stored (OS keychain); access tokens live in
// memory and are used for IMAP/SMTP via XOAUTH2.
import { createHash, randomBytes } from 'node:crypto';
import { TIMEOUTS, withTimeout } from './http-timeout.mjs';

export const PROVIDERS = {
  microsoft: {
    name: 'Microsoft 365 / Outlook.com',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'openid',
      'email',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
      'https://graph.microsoft.com/Calendars.ReadWrite',
      'https://graph.microsoft.com/Contacts.ReadWrite',
      'https://graph.microsoft.com/Tasks.ReadWrite',
      'https://graph.microsoft.com/MailboxSettings.ReadWrite'
    ],
    // Microsoft issues one access token per resource: mail (Outlook) and calendar/contacts (Graph).
    mailScope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    cloudScope:
      'offline_access https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Contacts.ReadWrite',
    // Microsoft To Do: its own token, so accounts without this consent keep calendar and contacts.
    tasksScope: 'offline_access https://graph.microsoft.com/Tasks.ReadWrite',
    // Out-of-office reply (mailboxSettings): its own token, asked for once when it is first used.
    settingsScope: 'offline_access https://graph.microsoft.com/MailboxSettings.ReadWrite',
    imapHost: 'outlook.office365.com',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    // v2.0 tokens: https://login.microsoftonline.com/<tenant id>/v2.0
    issuer: /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/,
    extraParams: { prompt: 'select_account' }
  },
  google: {
    name: 'Google / Gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'openid',
      'email',
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/tasks',
      // Out-of-office reply (users.settings.vacation); https://mail.google.com/ does not cover it.
      'https://www.googleapis.com/auth/gmail.settings.basic'
    ],
    imapHost: 'imap.gmail.com',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    issuer: /^(https:\/\/)?accounts\.google\.com$/,
    extraParams: { access_type: 'offline', prompt: 'consent' }
  }
};

const PENDING_TTL_MS = 10 * 60 * 1000;
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** Client IDs come from the build (package.json "levuvo.oauth") or environment variables. */
export function oauthConfigFrom(pkg = {}, env = process.env) {
  const fromPkg = pkg?.levuvo?.oauth || {};
  const pick = (provider, key) =>
    env[`LEVUVO_OAUTH_${provider.toUpperCase()}_${key}`] ||
    fromPkg[provider]?.[key === 'CLIENT_ID' ? 'clientId' : 'clientSecret'] ||
    '';
  return Object.fromEntries(
    Object.keys(PROVIDERS).map(p => [p, { clientId: pick(p, 'CLIENT_ID'), clientSecret: pick(p, 'CLIENT_SECRET') }])
  );
}

/** Email from the id_token received directly from the token endpoint over TLS (OIDC §3.1.3.7). */
/**
 * E-mail address from the ID token. With `expect`, the claims are checked as OpenID Connect
 * requires: issuer, audience (our client ID), expiry and the nonce of this sign-in. The token
 * comes straight from the provider's token endpoint over TLS, which OIDC Core 3.1.3.7 accepts
 * in place of checking the signature.
 */
export function emailFromIdToken(idToken, expect = null) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    if (expect) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const nowSec = Math.floor(expect.now / 1000);
      if (!expect.issuer?.test(String(payload.iss || ''))) return '';
      if (!aud.includes(expect.clientId)) return '';
      if (aud.length > 1 && payload.azp !== expect.clientId) return '';
      if (!Number.isFinite(payload.exp) || payload.exp < nowSec - 300) return '';
      if (!expect.nonce || payload.nonce !== expect.nonce) return '';
    }
    const email = String(payload.email || payload.preferred_username || payload.upn || '').toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  } catch {
    return '';
  }
}

export function createOAuthManager({
  config,
  providers = PROVIDERS,
  fetchImpl: rawFetch = globalThis.fetch,
  now = () => Date.now()
}) {
  const fetchImpl = withTimeout(rawFetch, TIMEOUTS.token);
  const pending = new Map();
  const tokens = new Map();
  const configured = id => Boolean(providers[id] && config?.[id]?.clientId);

  async function tokenRequest(provider, params) {
    const p = providers[provider];
    const body = new URLSearchParams({ client_id: config[provider].clientId, ...params });
    if (config[provider].clientSecret) body.set('client_secret', config[provider].clientSecret);
    let response;
    try {
      response = await fetchImpl(p.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body
      });
    } catch {
      throw fail('Der Anmeldedienst ist nicht erreichbar.', 'oauth_unreachable', 503);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_scope' || data.error === 'consent_required' || data.error === 'interaction_required')
        throw fail(
          'Für Kalender und Kontakte ist eine zusätzliche Freigabe nötig. Bitte „Kalender & Kontakte freigeben“ wählen.',
          'cloud_consent_required',
          403
        );
      if (data.error === 'invalid_grant')
        throw fail(
          'Die Anmeldung ist abgelaufen oder wurde widerrufen. Bitte das Konto neu anmelden.',
          'oauth_reauth_required',
          401
        );
      throw fail('Die Anmeldung wurde vom Anbieter abgelehnt.', 'oauth_rejected', 401);
    }
    return data;
  }

  return {
    providers: () =>
      Object.entries(providers)
        .filter(([id]) => configured(id))
        .map(([id, p]) => ({ id, name: p.name })),
    provider: id => providers[id],

    /** `relinkAccountId`: renews the consent of an existing account (e.g. for calendar & contacts). */
    start(provider, redirectUri, relinkAccountId = null) {
      if (!configured(provider))
        throw fail('Diese Anmeldung ist in dieser Version nicht eingerichtet.', 'oauth_not_configured', 404);
      for (const [state, entry] of pending) if (now() - entry.created > PENDING_TTL_MS) pending.delete(state);
      const verifier = b64url(randomBytes(48));
      const state = b64url(randomBytes(24));
      const nonce = b64url(randomBytes(24));
      pending.set(state, {
        provider,
        verifier,
        nonce,
        redirectUri,
        relinkAccountId,
        created: now(),
        status: 'pending'
      });
      const p = providers[provider];
      const url = new URL(p.authUrl);
      const params = {
        client_id: config[provider].clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: p.scopes.join(' '),
        state,
        nonce,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
        ...p.extraParams
      };
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return { state, authUrl: url.toString() };
    },

    /** Single-use: the state is consumed whether the exchange succeeds or not. */
    async complete(state, code) {
      const entry = typeof state === 'string' ? pending.get(state) : null;
      if (!entry || entry.status !== 'pending' || now() - entry.created > PENDING_TTL_MS)
        throw fail('Anmeldung abgelaufen. Bitte erneut starten.', 'oauth_state_invalid');
      entry.status = 'exchanging';
      if (typeof code !== 'string' || code.length < 4 || code.length > 4096)
        throw fail('Anmeldung unvollständig.', 'oauth_code_missing');
      const data = await tokenRequest(entry.provider, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: entry.redirectUri,
        code_verifier: entry.verifier,
        ...(providers[entry.provider].mailScope ? { scope: providers[entry.provider].mailScope } : {})
      });
      const email = emailFromIdToken(data.id_token, {
        issuer: providers[entry.provider].issuer,
        clientId: config[entry.provider].clientId,
        nonce: entry.nonce,
        now: now()
      });
      if (!email) throw fail('Die E-Mail-Adresse konnte nicht ermittelt werden.', 'oauth_email_missing');
      if (!data.refresh_token) throw fail('Der Anbieter hat keine dauerhafte Anmeldung erlaubt.', 'oauth_no_refresh');
      return {
        provider: entry.provider,
        relinkAccountId: entry.relinkAccountId || null,
        email,
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        expiresIn: Number(data.expires_in) || 3600
      };
    },
    setStatus(state, status) {
      const e = pending.get(state);
      if (e) Object.assign(e, status);
    },
    status(state) {
      const e = pending.get(state);
      return e ? { status: e.status, accountId: e.accountId || null, error: e.error || null } : { status: 'unknown' };
    },

    remember(accountId, accessToken, expiresIn) {
      tokens.set(accountId, { accessToken, expires: now() + (expiresIn - 60) * 1000 });
    },

    /**
     * Valid access token; refreshes if needed. `rotate` stores a new refresh token if the provider
     * rotates it. `resource: 'cloud'` asks for the calendar/contacts token (Microsoft Graph),
     * `resource: 'tasks'` for the Microsoft To Do token, `resource: 'settings'` for the mailbox
     * settings (out-of-office reply). Google issues one token for every granted scope.
     */
    async accessToken(accountId, provider, refreshToken, rotate, { resource = 'mail' } = {}) {
      const p = providers[provider] || {};
      const scopes = { tasks: p.tasksScope, cloud: p.cloudScope, settings: p.settingsScope };
      const scope = resource in scopes ? scopes[resource] : p.mailScope;
      const key = scopes[resource] ? `${accountId}|${resource}` : accountId;
      const cached = tokens.get(key);
      if (cached && cached.expires > now()) return cached.accessToken;
      if (!refreshToken) throw fail('Bitte das Konto neu anmelden.', 'oauth_reauth_required', 401);
      const data = await tokenRequest(provider, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        ...(scope ? { scope } : {})
      });
      if (data.refresh_token && data.refresh_token !== refreshToken) await rotate?.(data.refresh_token);
      tokens.set(key, {
        accessToken: data.access_token,
        expires: now() + ((Number(data.expires_in) || 3600) - 60) * 1000
      });
      return data.access_token;
    },
    forget(accountId) {
      tokens.delete(accountId);
      tokens.delete(`${accountId}|cloud`);
      tokens.delete(`${accountId}|tasks`);
      tokens.delete(`${accountId}|settings`);
    }
  };
}

export function callbackPage(ok, message) {
  const text = String(message).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Levuvo Mail</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;background:#0b0b0b;color:#f2f2f2;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}main{max-width:460px;padding:32px}h1{font-size:26px;margin:0 0 10px}p{color:#bbb}</style>
</head><body><main><h1>${ok ? 'Anmeldung abgeschlossen.' : 'Anmeldung fehlgeschlagen.'}</h1><p>${text}</p><p>Du kannst dieses Fenster schließen und zu Levuvo Mail zurückkehren.</p></main></body></html>`;
}
