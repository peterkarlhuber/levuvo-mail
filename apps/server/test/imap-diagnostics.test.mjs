import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImapError, publicImapFailure } from '../src/imap-diagnostics.mjs';

test('IMAP Fehlerklassen verraten keine Rohdaten', () => {
  const err = Object.assign(new Error('authentication failed for secret@example.org'), { authenticationFailed: true });
  const result = classifyImapError(err);
  assert.equal(result.code, 'imap_auth_failed');
  assert.equal(JSON.stringify(result).includes('secret@example.org'), false);
});
test('temporärer Netzwerkfehler ist wiederholbar, Zertifikatsfehler nicht', () => {
  assert.equal(classifyImapError({ code: 'ETIMEDOUT' }).retryable, true);
  assert.equal(classifyImapError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }).retryable, false);
});
test('Befehlsfehler wird getrennt vom Verbindungsfehler gemeldet', () => {
  assert.equal(publicImapFailure(new Error('private path'), { connected: true }).code, 'imap_operation_failed');
});
