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
  'SMTP-MIME hat Inhalt/Anhang, aber keinen sichtbaren BCC-Header',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
  async () => {
    const raw = await service.composeRawEmail('info@levuvo.com', draft);
    const mime = raw.toString('utf8');
    assert.match(mime, /Subject:\s*Projektupdate/i);
    assert.match(mime, /In-Reply-To:\s*<original@example.org>/i);
    assert.match(mime, /filename="?demo\.txt"?/i);
    assert.doesNotMatch(mime, /(?:^|\r?\n)Bcc\s*:/i);
    assert.doesNotMatch(mime, /blind@example\.org/i); // Auch die BCC-Adresse selbst darf nicht im MIME stehen.
  }
);

test(
  'SMTP-Submission verwendet Envelope mit BCC (ohne Header)',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
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
  'Nach erfolgreichem SMTP wird eine identische Kopie in Gesendet eingefügt',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
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
  'Fehlgeschlagenes Speichern löst niemals einen zweiten SMTP-Versand aus',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
  async () => {
    const saved = await service.appendToSent(async () => {
      throw Error('IMAP nicht erreichbar');
    }, Buffer.from('test'));
    assert.deepEqual(saved, { saved: false, folder: null, reason: 'imap_failed' });
  }
);

test(
  'Fehlender Gesendet-Ordner liefert einen konkreten Diagnosecode',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
  async () => {
    const result = await service.appendToSent(
      async fn => fn({ list: async () => [{ path: 'INBOX' }] }),
      Buffer.from('test')
    );
    assert.deepEqual(result, { saved: false, folder: null, reason: 'sent_folder_not_found' });
  }
);

test(
  'IMAP APPEND mit false gilt nicht als gespeicherte Nachricht',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
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
  'IMAP APPEND-Ausnahme wird als Speicherproblem gemeldet',
  { skip: !service && 'nodemailer muss installiert sein (npm install)' },
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
