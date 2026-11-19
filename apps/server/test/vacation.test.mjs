import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSieveScript, parseLevuvoScript, saveSieve, validateSieveConfig } from '../src/sieve.mjs';
import { composeVacation, mimeImageParts, textToHtml, vacationMime, withoutEmbeddedImages } from '../src/vacation.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const img = (alt = 'Logo') => `<img src="data:image/png;base64,${PNG}" alt="${alt}">`;
const config = (vacation = {}) =>
  validateSieveConfig(
    {
      rules: [],
      vacation: {
        enabled: true,
        subject: 'Abwesend',
        bodyHtml: `<p><strong>Bis 6.1.</strong> nicht da – „dringend“ an <a href="mailto:a@b.de">a@b.de</a></p>${img('Bild')}`,
        includeSignature: true,
        days: 3,
        ...vacation
      }
    },
    { folderExists: () => true }
  );
const SIGNATURE = `<p>Peter Beispiel</p>${img('Firmenlogo')}`;

/** Minimal ManageSieve stand-in: records the stored script, can reject :mime. */
function fakeClient({ rejectMime = false, space = true } = {}) {
  const calls = [];
  return {
    calls,
    stored: null,
    async listScripts() {
      return [];
    },
    async checkScript(script) {
      calls.push('check');
      if (rejectMime && script.includes(':mime'))
        throw Object.assign(new Error('unknown tagged argument :mime'), { code: 'sieve_rejected' });
    },
    async haveSpace() {
      return space;
    },
    async putScript(name, script) {
      calls.push('put');
      this.stored = script;
    },
    async setActive() {
      calls.push('active');
    }
  };
}

test('Vacation: formatted text with signature becomes a MIME reply with inline images', () => {
  const c = config();
  const script = buildSieveScript(c, { signatureHtml: SIGNATURE });
  assert.match(script, /vacation :days 3 :subject "Abwesend" :mime "MIME-Version: 1\.0\r\n/);
  assert.match(script, /Content-Type: multipart\/alternative; boundary=\\"alt-/);
  assert.match(script, /Content-Type: text\/plain; charset=utf-8/);
  assert.match(script, /Content-Type: multipart\/related/);
  assert.match(script, /Content-ID: <body1@levuvo>/);
  assert.match(script, /Content-ID: <sig1@levuvo>/);
  // The stored model refers to the body image by Content-ID: the image is in the script once.
  const model = JSON.parse(Buffer.from(/# levuvo-rules: (\S+)/.exec(script)[1], 'base64').toString('utf8'));
  assert.ok(!model.vacation.bodyHtml.includes('data:'));
  assert.ok(model.vacation.bodyHtml.includes('cid:body1@levuvo'));
  // Reading it back restores the editor content exactly.
  assert.deepEqual(parseLevuvoScript(script), c);
});

test('Vacation: the HTML and text versions carry text, link and signature', () => {
  const content = composeVacation(config().vacation, SIGNATURE);
  assert.match(content.text, /Bis 6\.1\. nicht da/);
  assert.match(content.text, /Peter Beispiel/);
  assert.match(content.text, /^--$/m);
  const mime = vacationMime({ html: content.html, text: content.text }, { boundary: () => 'x' });
  const html = Buffer.from(
    /text\/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)\r\n--/.exec(mime)[1],
    'base64'
  ).toString('utf8');
  assert.match(html, /<strong>Bis 6\.1\.<\/strong>/);
  assert.match(html, /href="mailto:a@b\.de"/);
  assert.ok(
    mime.split('\r\n').every(line => line.length <= 998),
    'MIME lines stay short'
  );
});

test('Vacation: without signature and in text format the script is plain', () => {
  const c = config({ includeSignature: false });
  const text = buildSieveScript(c, { signatureHtml: SIGNATURE, format: 'text' });
  assert.ok(!text.includes(':mime'));
  assert.ok(!text.includes('Peter Beispiel'));
  assert.match(text, /:subject "Abwesend" "Bis 6\.1\. nicht da – „dringend“ an mailto:a@b\.de"/);
  // In text format the model keeps the image itself, so the editor shows it again.
  assert.deepEqual(parseLevuvoScript(text), c);
});

test('Vacation: active content is removed before it reaches the server', () => {
  const c = config({
    bodyHtml: '<p onclick="x()">Hallo<script>alert(1)</script></p><img src="data:image/svg+xml;base64,PHN2Zy8+">',
    includeSignature: false
  });
  assert.equal(c.vacation.bodyHtml, '<p>Hallo</p>');
  assert.throws(() => config({ bodyHtml: '<p> </p>' }), /Text für die Abwesenheitsnotiz/);
});

test('Vacation: too many images are refused with a clear message', () => {
  const many = config({ bodyHtml: `<p>x</p>${img()}${img()}${img()}${img()}`, includeSignature: true });
  assert.throws(() => buildSieveScript(many, { signatureHtml: SIGNATURE }), /zu viele oder zu große Bilder/);
});

test('Vacation: servers without :mime get the text reply, oversize scripts are refused', async () => {
  const plain = fakeClient({ rejectMime: true });
  const result = await saveSieve(plain, config(), { trashFolder: '', signatureHtml: SIGNATURE });
  assert.equal(result.format, 'text');
  assert.deepEqual(plain.calls, ['check', 'check', 'put', 'active']);
  assert.ok(!plain.stored.includes(':mime'));
  assert.match(plain.stored, /Peter Beispiel/);

  const rich = fakeClient();
  assert.equal((await saveSieve(rich, config(), { trashFolder: '', signatureHtml: SIGNATURE })).format, 'html');
  assert.equal(mimeImageParts(rich.stored).length, 2);

  const full = fakeClient({ space: false });
  await assert.rejects(saveSieve(full, config(), { trashFolder: '' }), err => err.code === 'sieve_too_large');
  assert.equal(full.stored, null);
});

test('Vacation: scripts from older versions (plain text) open in the editor', () => {
  const legacy = {
    rules: [],
    vacation: { enabled: true, subject: '', body: 'Zeile 1\nZeile <2>', days: 1, start: '', end: '', addresses: [] }
  };
  const script = `# levuvo-rules: ${Buffer.from(JSON.stringify(legacy)).toString('base64')}\r\n`;
  const parsed = parseLevuvoScript(script);
  assert.equal(parsed.vacation.bodyHtml, textToHtml('Zeile 1\nZeile <2>'));
  assert.equal(parsed.vacation.bodyHtml, '<p>Zeile 1<br>Zeile &lt;2&gt;</p>');
  assert.equal(parsed.vacation.includeSignature, false);
  assert.ok(!('body' in parsed.vacation));
  // Older clients that still send `body` keep working.
  assert.equal(
    validateSieveConfig({ rules: [], vacation: { enabled: true, body: 'Hallo' } }).vacation.bodyHtml,
    '<p>Hallo</p>'
  );
});

test('Vacation: provider copies keep web images and drop embedded ones', () => {
  const { html, removed } = withoutEmbeddedImages(`<p>a</p>${img()}<img src="https://example.org/logo.png" alt="">`);
  assert.equal(removed, 1);
  assert.equal(html, '<p>a</p><img src="https://example.org/logo.png" alt="">');
});
