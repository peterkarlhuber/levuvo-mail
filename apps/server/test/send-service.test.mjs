import test from 'node:test';
import assert from 'node:assert/strict';

let service;
try {
  service = await import('../src/send-service.mjs');
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}

const draft = {
  to: ['kunde@example.org'],
  cc: ['team@example.org'],
  bcc: ['blind@example.org'],
  subject: 'Projektupdate',
  text: 'Eine Nachricht mit Anhang.',
  attachments: [{ filename: 'demo.txt', content: Buffer.from('Levuvo Test'), contentType: 'text/plain' }],
  inReplyTo: '<original@example.org>'
};

test(
  'SMTP MIME has content/attachment but no visible BCC header',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const raw = await service.composeRawEmail('info@levuvo.com', draft);
    const mime = raw.toString('utf8');
    assert.match(mime, /Subject:\s*Projektupdate/i);
    assert.match(mime, /In-Reply-To:\s*<original@example.org>/i);
    assert.match(mime, /filename="?demo\.txt"?/i);
    assert.doesNotMatch(mime, /(?:^|\r?\n)Bcc\s*:/i);
    assert.doesNotMatch(mime, /blind@example\.org/i); // The BCC address itself must not appear in the MIME either.
  }
);

test(
  'SMTP submission uses an envelope with BCC (without header)',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const calls = [];
    const fake = {
      sendMail: async args => {
        calls.push(args);
        return { accepted: ['kunde@example.org', 'team@example.org', 'blind@example.org'], rejected: [] };
      },
      close: () => {
        calls.push('closed');
      }
    };
    const result = await service.submitEmail({ user: 'info@levuvo.com' }, draft, Buffer.from('MIME'), fake);
    assert.equal(result.accepted.length, 3);
    assert.deepEqual(calls[0].envelope.to, ['kunde@example.org', 'team@example.org', 'blind@example.org']);
    assert.equal(calls[0].envelope.from, 'info@levuvo.com');
    assert.equal(calls[1], 'closed');
  }
);

test(
  'After successful SMTP an identical copy is appended to Sent',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const calls = [];
    const raw = Buffer.from('Testnachricht');
    const saved = await service.appendToSent(
      async fn =>
        fn({
          list: async () => [{ path: 'INBOX.Sent', specialUse: '\\Sent' }],
          append: async (folder, bytes, flags) => {
            calls.push({ folder, bytes, flags });
            return { destination: folder, uid: 1 };
          }
        }),
      raw
    );
    assert.deepEqual(saved, { saved: true, folder: 'INBOX.Sent', reason: null });
    assert.equal(calls[0].folder, 'INBOX.Sent');
    assert.equal(calls[0].bytes, raw);
    assert.deepEqual(calls[0].flags, ['\\Seen']);
  }
);

test(
  'Failed saving never triggers a second SMTP send',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const saved = await service.appendToSent(async () => {
      throw Error('IMAP nicht erreichbar');
    }, Buffer.from('test'));
    assert.deepEqual(saved, { saved: false, folder: null, reason: 'imap_failed' });
  }
);

test(
  'Missing Sent folder returns a specific diagnostic code',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const result = await service.appendToSent(
      async fn => fn({ list: async () => [{ path: 'INBOX' }] }),
      Buffer.from('test')
    );
    assert.deepEqual(result, { saved: false, folder: null, reason: 'sent_folder_not_found' });
  }
);

test(
  'IMAP APPEND returning false does not count as a saved message',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const result = await service.appendToSent(
      async fn =>
        fn({
          list: async () => [{ path: 'Gesendet', specialUse: '\\Sent' }],
          append: async () => false
        }),
      Buffer.from('test')
    );
    assert.deepEqual(result, { saved: false, folder: 'Gesendet', reason: 'append_rejected' });
  }
);

test(
  'IMAP APPEND exception is reported as a save problem',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const result = await service.appendToSent(
      async fn =>
        fn({
          list: async () => [{ path: 'Gesendet', specialUse: '\\Sent' }],
          append: async () => {
            throw Error('permission denied');
          }
        }),
      Buffer.from('test')
    );
    assert.deepEqual(result, { saved: false, folder: 'Gesendet', reason: 'append_failed' });
  }
);

test(
  'Without a Sent folder one is created and the copy is stored there',
  { skip: !service && 'nodemailer must be installed (npm install)' },
  async () => {
    const calls = [];
    const result = await service.appendToSent(
      async fn =>
        fn({
          list: async () => [{ path: 'INBOX', delimiter: '/' }],
          mailboxCreate: async path => calls.push(['create', path]) && { path },
          append: async path => {
            calls.push(['append', path]);
            return { uid: 3 };
          }
        }),
      Buffer.from('test')
    );
    assert.equal(result.saved, true);
    assert.deepEqual(calls, [
      ['create', 'INBOX/Sent'],
      ['append', 'INBOX/Sent']
    ]);
  }
);
