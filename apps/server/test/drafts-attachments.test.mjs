import test from 'node:test';
import assert from 'node:assert/strict';
// Imported unconditionally: a missing module must fail the run, never skip the tests (QA-LEV-012).
const PostalMime = (await import('postal-mime')).default;
const draftLib = await import('../src/drafts.mjs');
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
test('Drafts store MIME attachments with identical bytes', async () => {
  const content = Buffer.from([0, 1, 2, 0, 250, 255]);
  const item = { name: 'prüfung.txt', contentBase64: content.toString('base64') };
  const data = draftLib.validateDraft({ ...draft, attachments: [item] });
  const raw = await draftLib.composeDraft('peter@example.at', data);
  const parsed = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  assert.equal(parsed.attachments.length, 1);
  assert.deepEqual(Buffer.from(parsed.attachments[0].content), content);
});
test('Invalid Base64 and oversized attachments are blocked', () => {
  assert.throws(() => draftLib.validateDraft({ ...draft, attachments: [{ name: 'x', contentBase64: '!!!=' }] }));
  assert.throws(() =>
    draftLib.validateDraft({
      ...draft,
      attachments: Array.from({ length: 9 }, () => ({ name: 'x', contentBase64: 'AA==' }))
    })
  );
});
