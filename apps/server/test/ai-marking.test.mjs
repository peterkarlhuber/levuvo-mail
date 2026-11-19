import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_ASSISTED_HEADER, readAiAssisted, validateSendPayload } from '../src/send-utils.mjs';
import { composeRawEmail } from '../src/send-service.mjs';

const base = {
  requestId: '123e4567-e89b-12d3-a456-426614174000',
  confirm: 'SEND',
  to: ['bob@example.com'],
  cc: [],
  bcc: [],
  subject: 'Hi',
  text: 'Hello',
  attachments: []
};

test('AI Act Art. 50(2): the send payload carries a printable, single-line AI marking', () => {
  assert.equal(validateSendPayload(base).aiAssisted, undefined);
  assert.equal(
    validateSendPayload({ ...base, aiAssisted: 'Levuvo Mail Assistant; model=qwen3.5:9b' }).aiAssisted,
    'Levuvo Mail Assistant; model=qwen3.5:9b'
  );
  assert.equal(readAiAssisted(''), '');
  for (const bad of ['x\r\nBcc: eve@evil.test', 'ü', 'a'.repeat(161), 42])
    assert.throws(() => readAiAssisted(bad), /KI-Kennzeichnung/);
});

test('the header ends up in the MIME message', async () => {
  const raw = (
    await composeRawEmail(
      { address: 'me@example.com' },
      { ...validateSendPayload(base) },
      { headers: { [AI_ASSISTED_HEADER]: 'agent; Helper' } }
    )
  ).toString();
  assert.match(raw, /^X-Levuvo-AI-Assisted: agent; Helper\r?$/im, 'header names are case-insensitive');
});
