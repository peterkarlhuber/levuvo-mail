// Checks IMAP login and SMTP login before an account is saved.
// No message is read, sent or changed.
import { classifyImapError } from './imap-diagnostics.mjs';

const failure = (message, code, { field, retryable = false } = {}) =>
  Object.assign(new Error(message), { statusCode: 422, code, field, retryable });

export function classifySmtpError(err) {
  const code = String(err?.code || '').toUpperCase();
  const response = Number(err?.responseCode || 0);
  if (code === 'EAUTH' || response === 535 || response === 534) {
    return {
      code: 'smtp_auth_failed',
      error: 'SMTP-Anmeldung fehlgeschlagen. Benutzername und Passwort für den Versand prüfen.',
      retryable: false
    };
  }
  if (/^ERR_TLS_|CERT_|SELF_SIGNED/.test(code) || /certificate/i.test(String(err?.message))) {
    return {
      code: 'smtp_tls_failed',
      error: 'TLS-Zertifikat des SMTP-Servers konnte nicht geprüft werden.',
      retryable: false
    };
  }
  if (['EDNS', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return { code: 'smtp_dns_failed', error: 'SMTP-Server ist nicht auflösbar. Servername prüfen.', retryable: true };
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'EGREETING'].includes(code)) {
    return {
      code: 'smtp_unreachable',
      error: 'SMTP-Server ist derzeit nicht erreichbar. Server und Port prüfen.',
      retryable: true
    };
  }
  return {
    code: 'smtp_failed',
    error: 'SMTP-Prüfung fehlgeschlagen. Server, Port und Zugangsdaten prüfen.',
    retryable: false
  };
}

/**
 * @param {{imap:{host,port,user,password}, smtp:{host,port,user,password}}} config
 * @param {{imapFactory:Function, smtpFactory:Function}} deps
 */
export async function verifyAccountConfig(config, { imapFactory, smtpFactory }) {
  const imap = imapFactory({ ...config.imap, configured: true });
  try {
    await imap.connect();
  } catch (err) {
    const info = classifyImapError(err);
    throw failure(info.error, info.code, { field: 'imap', retryable: info.retryable });
  } finally {
    try {
      await imap.logout();
    } catch {
      try {
        imap.close();
      } catch {
        /* ignore */
      }
    }
  }
  const transport = smtpFactory({ ...config.smtp, configured: true });
  try {
    await transport.verify();
  } catch (err) {
    const info = classifySmtpError(err);
    throw failure(info.error, info.code, { field: 'smtp', retryable: info.retryable });
  } finally {
    transport.close?.();
  }
  return { ok: true };
}
