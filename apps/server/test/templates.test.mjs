import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateStore, validateTemplate } from '../src/templates.mjs';

test('Templates: sanitized, validated, saved and deleted', async () => {
  assert.throws(() => validateTemplate({ name: '', html: '<p>x</p>' }), /Namen/);
  assert.throws(() => validateTemplate({ name: 'Leer', html: '<p> </p>' }), /leer/);
  assert.throws(() => validateTemplate({ name: 'X', subject: 'a\r\nBcc: x@y', html: '<p>x</p>' }), /Betreff/);
  let v = {};
  const store = createTemplateStore({
    get: () => v,
    save: async n => {
      v = n;
    }
  });
  const a = await store.save({
    name: 'Zusage',
    subject: 'Termin',
    html: '<p onclick="x()">Hallo {Vorname}<script>alert(1)</script></p>'
  });
  assert.equal(a.html, '<p>Hallo {Vorname}</p>');
  const b = await store.save({ id: a.id, name: 'Zusage', subject: 'Termin bestätigt', html: '<p>Hallo</p>' });
  assert.equal(b.id, a.id);
  assert.equal(store.list().length, 1);
  await store.remove(a.id);
  assert.deepEqual(store.list(), []);
});

test('Templates: optional shortcut is normalised, validated and unique', async () => {
  assert.equal(validateTemplate({ name: 'A', html: '<p>x</p>', shortcut: ' ;MfG ' }).shortcut, 'mfg');
  assert.equal(validateTemplate({ name: 'A', html: '<p>x</p>', shortcut: '' }).shortcut, undefined);
  assert.throws(() => validateTemplate({ name: 'A', html: '<p>x</p>', shortcut: 'a' }), /Kürzel/);
  assert.throws(() => validateTemplate({ name: 'A', html: '<p>x</p>', shortcut: 'mit leer' }), /Kürzel/);
  let v = {};
  const store = createTemplateStore({ get: () => v, save: async n => void (v = n) });
  const a = await store.save({ name: 'Gruß', html: '<p>Mit freundlichen Grüßen</p>', shortcut: 'mfg' });
  await assert.rejects(store.save({ name: 'Anderer', html: '<p>x</p>', shortcut: 'MFG' }), /vergeben/);
  const again = await store.save({ id: a.id, name: 'Gruß', html: '<p>LG</p>', shortcut: 'mfg' });
  assert.equal(again.shortcut, 'mfg');
});
