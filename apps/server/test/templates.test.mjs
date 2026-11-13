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
