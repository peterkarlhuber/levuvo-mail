import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImapError, publicImapFailure } from '../src/imap-diagnostics.mjs';

test('IMAP error classes reveal no raw data', () => {
  const err = Object.assign(new Error('authentication failed for secret@example.org'), { authenticationFailed: true });
  const result = classifyImapError(err);
  assert.equal(result.code, 'imap_auth_failed');
  assert.equal(JSON.stringify(result).includes('secret@example.org'), false);
});
test('temporary network error is retryable, certificate error is not', () => {
  assert.equal(classifyImapError({ code: 'ETIMEDOUT' }).retryable, true);
  assert.equal(classifyImapError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }).retryable, false);
});
test('command error is reported separately from connection error', () => {
  assert.equal(publicImapFailure(new Error('private path'), { connected: true }).code, 'imap_operation_failed');
});
