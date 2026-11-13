import test from 'node:test';
import assert from 'node:assert/strict';
let PostalMime, draftLib;
try {
  PostalMime = (await import('postal-mime')).default;
  draftLib = await import('../src/drafts.mjs');
} catch (err) {
  if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}
const skip = !PostalMime || !draftLib ? 'npm install erforderlich' : false;
const draft = {
  draftId: '11111111-2222-4222-8222-333333333333',
  to: [],
  cc: [],
  bcc: [],
  subject: 'Anhang',
  text: 'Text',
  previousUid: null,
  uidValidity: null
};
test('Entwürfe speichern MIME-Anhänge mit identischen Bytes', { skip }, async () => {
  const content = Buffer.from([0, 1, 2, 0, 250, 255]);
  const item = { name: 'prüfung.txt', contentBase64: content.toString('base64') };
  const data = draftLib.validateDraft({ ...draft, attachments: [item] });
  const raw = await draftLib.composeDraft('peter@example.at', data);
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  assert.equal(parsed.attachments.length, 1);
  assert.deepEqual(Buffer.from(parsed.attachments[0].content), content);
});
test('Ungültiges Base64 und übergroße Anhänge werden blockiert', { skip }, () => {
  assert.throws(() => draftLib.validateDraft({ ...draft, attachments: [{ name: 'x', contentBase64: '!!!=' }] }));
  assert.throws(() =>
    draftLib.validateDraft({
      ...draft,
      attachments: Array.from({ length: 9 }, () => ({ name: 'x', contentBase64: 'AA==' }))
    })
  );
});
