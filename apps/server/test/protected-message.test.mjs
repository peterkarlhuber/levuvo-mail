import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProtectedFile,
  findProtectedBox,
  openPayload,
  MIN_OPEN_ITERATIONS,
  MAX_OPEN_ITERATIONS,
  protectedNotice,
  readPasswordProtection,
  sealPayload,
  PROTECTED_FILENAME
} from '../src/protected-message.mjs';
import { readSecurity } from '../src/send-utils.mjs';

test('Protect with password: inputs are validated', () => {
  assert.throws(() => readPasswordProtection({ password: 'kurz' }), /mindestens 10/);
  assert.throws(() => readPasswordProtection({ password: 'x'.repeat(201) }), /zu lang/);
  assert.throws(
    () => readPasswordProtection({ password: 'Sommer-2026!', hint: 'sommer-2026! ist es' }),
    /nicht enthalten/
  );
  assert.deepEqual(readPasswordProtection({ password: 'Sommer-2026!', hint: 'Unser Urlaubsort + Jahr' }), {
    password: 'Sommer-2026!',
    hint: 'Unser Urlaubsort + Jahr'
  });
  const sec = readSecurity({ method: 'password', password: 'Sommer-2026!' });
  assert.equal(sec.method, 'password');
  assert.equal(sec.encrypt, true);
  assert.throws(() => readSecurity({ method: 'password', password: '123' }), /mindestens 10/);
});

test('Protect with password: encrypt, open, wrong password, size limit', async () => {
  const box = await sealPayload({ hello: 'Grüße €' }, 'Ein langes Passwort', { iterations: MIN_OPEN_ITERATIONS });
  assert.deepEqual(await openPayload(box, 'Ein langes Passwort'), { hello: 'Grüße €' });
  await assert.rejects(
    openPayload(box, 'falsch falsch'),
    err => err.code === 'protected_wrong_password' && err.statusCode === 403
  );
  await assert.rejects(openPayload({ ...box, iter: 99_000_000 }, 'x'), /Unbekanntes Format/);
  await assert.rejects(
    () =>
      buildProtectedFile(
        {
          from: { address: 'a@b.test' },
          subject: 's',
          text: 't',
          attachments: [{ filename: 'gross.bin', content: Buffer.alloc(5 * 1024 * 1024 + 1) }]
        },
        { password: 'Ein langes Passwort', hint: '' }
      ),
    err => err.code === 'protected_too_large'
  );
});

test('Protect with password: file is self-contained, decryptable in the browser (WebCrypto) and is detected', async () => {
  const { file, box } = await buildProtectedFile(
    {
      from: { name: 'Peter Karlhuber', address: 'peter@levuvo.test' },
      subject: 'Zugangsdaten Server',
      html: '<p>Benutzer: <b>admin</b></p>',
      text: 'Benutzer: admin',
      attachments: [{ filename: 'vertrag.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') }]
    },
    { password: 'Pferd-Batterie-Klammer', hint: 'Die drei Wörter vom Workshop' }
  );
  assert.doesNotMatch(file, /admin|Zugangsdaten|vertrag\.pdf/, 'no plain text in the file');
  assert.match(file, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(file, /https?:\/\/(?!www\.w3)/, 'no external addresses');
  assert.match(file, /Die drei Wörter vom Workshop/);

  // Same algorithm as the viewer script, through WebCrypto (what the recipient's browser does).
  const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('Pferd-Batterie-Klammer'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = JSON.parse(
    new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct)))
  );
  assert.equal(plain.subject, 'Zugangsdaten Server');
  assert.equal(plain.from, 'Peter Karlhuber <peter@levuvo.test>');
  assert.equal(Buffer.from(plain.attachments[0].data, 'base64').toString(), '%PDF-1.4 test');

  const found = findProtectedBox([
    { filename: 'andere.html', content: '<p>x</p>' },
    { filename: PROTECTED_FILENAME, content: Buffer.from(file) }
  ]);
  assert.equal(found.hint, 'Die drei Wörter vom Workshop');
  assert.equal((await openPayload(found.box, 'Pferd-Batterie-Klammer')).html, '<p>Benutzer: <b>admin</b></p>');
  assert.equal(findProtectedBox([{ filename: 'x.html', content: '<script>levuvo-protected</script>' }]), null);

  const notice = protectedNotice({ sender: 'Peter', hint: '<b>x</b>' });
  assert.match(notice.text, /Geschuetzte-Nachricht\.html/);
  assert.match(notice.html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('Protect with password: hostile boxes are refused early and never block the event loop (AUD-012)', async () => {
  const good = await sealPayload({ a: 1 }, 'Ein langes Passwort', { iterations: MIN_OPEN_ITERATIONS });
  for (const bad of [
    { ...good, iter: MAX_OPEN_ITERATIONS + 1 },
    { ...good, iter: 10 },
    { ...good, iter: 1.5 },
    { ...good, salt: 'x' },
    { ...good, iv: 'AAAA' },
    { ...good, ct: 'not base64!' },
    { ...good, kdf: 'scrypt' },
    null
  ])
    await assert.rejects(openPayload(bad, 'Ein langes Passwort'), { code: 'protected_invalid' });
  // The derivation runs off the main thread: timers keep firing while a box is opened.
  const slow = await sealPayload({ a: 1 }, 'Ein langes Passwort', { iterations: 600_000 });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  await openPayload(slow, 'Ein langes Passwort');
  clearInterval(timer);
  assert.ok(ticks > 0, 'event loop stayed responsive');
  // PERF-LEV-012: sealing with the full 600,000 iterations does not block the loop either.
  let sealTicks = 0;
  const sealTimer = setInterval(() => sealTicks++, 5);
  await sealPayload({ a: 1 }, 'Ein langes Passwort');
  clearInterval(sealTimer);
  assert.ok(sealTicks > 0, 'event loop stayed responsive while sealing');
});
