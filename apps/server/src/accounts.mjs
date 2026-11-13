import { mailConfig } from './config.mjs';
import { smtpConfig } from './send-utils.mjs';

const MAX_ACCOUNTS = 5;
const signature = value =>
  String(value || '')
    .replace(/\\n/g, '\n')
    .replace(/\0/g, '')
    .slice(0, 2000);

export function buildAccounts(env = process.env) {
  const items = [];
  const first = {
    id: 'primary',
    label:
      String(env.MAIL_PRIMARY_LABEL || 'Hauptpostfach')
        .trim()
        .slice(0, 80) || 'Hauptpostfach',
    imap: mailConfig(env),
    smtp: smtpConfig(env),
    sentFolder: String(env.SENT_FOLDER || '').trim(),
    draftsFolder: String(env.DRAFTS_FOLDER || '').trim(),
    signature: signature(env.MAIL_PRIMARY_SIGNATURE)
  };
  items.push(first);
  const used = new Set(first.imap.configured ? [first.imap.user.toLowerCase()] : []);
  for (let index = 2; index <= MAX_ACCOUNTS; index++) {
    const prefix = `MAIL_ACCOUNT_${index}_`;
    const user = String(env[`${prefix}USER`] || '').trim();
    const password = String(env[`${prefix}PASSWORD`] || '');
    if (!user && !password) continue;
    if (!user || !password) throw new Error(`Konto ${index}: USER und PASSWORD sind beide erforderlich.`);
    if (used.has(user.toLowerCase())) throw new Error(`Konto ${index}: E-Mail-Adresse wurde doppelt konfiguriert.`);
    used.add(user.toLowerCase());
    const specific = {
      IMAP_HOST: env[`${prefix}IMAP_HOST`] || env.IMAP_HOST,
      IMAP_PORT: env[`${prefix}IMAP_PORT`] || env.IMAP_PORT,
      IMAP_USER: user,
      IMAP_PASSWORD: password,
      SMTP_HOST: env[`${prefix}SMTP_HOST`] || env.SMTP_HOST,
      SMTP_PORT: env[`${prefix}SMTP_PORT`] || env.SMTP_PORT,
      SMTP_USER: env[`${prefix}SMTP_USER`] || user,
      SMTP_PASSWORD: env[`${prefix}SMTP_PASSWORD`] || password,
      ENABLE_SEND: env.ENABLE_SEND
    };
    const imap = mailConfig(specific);
    const smtp = smtpConfig(specific);
    if (!smtp.configured) throw new Error(`Konto ${index}: SMTP-Konfiguration ist unvollständig.`);
    items.push({
      id: `account${index}`,
      label:
        String(env[`${prefix}LABEL`] || user)
          .trim()
          .slice(0, 80) || user,
      imap,
      smtp,
      sentFolder: String(env[`${prefix}SENT_FOLDER`] || '').trim(),
      draftsFolder: String(env[`${prefix}DRAFTS_FOLDER`] || '').trim(),
      signature: signature(env[`${prefix}SIGNATURE`])
    });
  }
  return items;
}

// Die öffentliche Kontenliste enthält niemals Zugangsdaten oder Host-Interna.
export function publicAccounts(accounts) {
  return accounts.map(account => ({
    id: account.id,
    label: account.label,
    mailbox: account.imap.configured ? account.imap.user : null,
    configured: account.imap.configured,
    managed: Boolean(account.managed)
  }));
}

export function resolveAccount(accounts, id) {
  const candidate = id === undefined ? 'primary' : id;
  if (typeof candidate !== 'string' || !/^(?:primary|account[2-5]|managed-[a-f0-9]{12})$/.test(candidate)) {
    const error = new Error('Ungültige Konto-ID.');
    error.statusCode = 400;
    throw error;
  }
  const account = accounts.find(a => a.id === candidate);
  if (!account) {
    const error = new Error('Unbekanntes Konto.');
    error.statusCode = 404;
    throw error;
  }
  return account;
}

export function accountScopedRequestKey(account, requestId) {
  return `${account.id}:${requestId}`;
}
