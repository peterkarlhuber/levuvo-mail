// Avoid raw IMAP errors in the browser: they may carry mailbox or server information.
export function classifyImapError(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '').toUpperCase();
  const auth =
    err?.authenticationFailed === true ||
    /AUTHENTICATIONFAILED|AUTHENTICATION FAILED|INVALID CREDENTIALS/.test(message);
  if (auth)
    return {
      code: 'imap_auth_failed',
      error: 'IMAP-Anmeldung fehlgeschlagen. Benutzername und Passwort prüfen.',
      retryable: false
    };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code))
    return { code: 'imap_dns_failed', error: 'Mailserver ist derzeit nicht auflösbar.', retryable: true };
  if (/^ERR_TLS_|CERT_|SELF_SIGNED_CERT/.test(code))
    return {
      code: 'imap_tls_failed',
      error: 'TLS-Zertifikat des Mailservers konnte nicht geprüft werden.',
      retryable: false
    };
  if (
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EPIPE', 'ECONNREFUSED'].includes(code) ||
    /TIMEOUT/.test(message)
  ) {
    return {
      code: 'imap_temporarily_unavailable',
      error: 'IMAP-Server vorübergehend nicht erreichbar. Verbindung erneut versuchen.',
      retryable: true
    };
  }
  return {
    code: 'imap_connection_failed',
    error: 'IMAP-Abruf fehlgeschlagen. Bitte Verbindung und Server prüfen.',
    retryable: false
  };
}
export function publicImapFailure(err, { connected = false } = {}) {
  const result = classifyImapError(err);
  return connected && result.code === 'imap_connection_failed'
    ? {
        code: 'imap_operation_failed',
        error: 'Der IMAP-Abruf ist fehlgeschlagen. Bitte Ansicht aktualisieren.',
        retryable: false
      }
    : result;
}
