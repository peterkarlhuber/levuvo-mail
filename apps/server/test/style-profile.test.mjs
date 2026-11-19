import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLocalIndex, encrypt } from '../src/local-index.mjs';
import {
  analyzeMail,
  buildProfile,
  contactSamples,
  createStyleProfiles,
  greetingPattern,
  ownPart
} from '../src/style-profile.mjs';
import { BACKUP_FILES, NOT_BACKED_UP } from '../src/backup.mjs';

test('one sent mail: greeting, closing, du/Sie and own part only', () => {
  const du = analyzeMail(
    'Hallo Anna,\n\nkannst du mir die Unterlagen schicken? Danke dir!\n\nLG\nPeter\n\nAm 3.11. schrieb Anna:\n> Sehr geehrte Damen und Herren, können Sie'
  );
  assert.deepEqual(
    { greeting: du.greeting, closing: du.closing, address: du.address },
    { greeting: 'Hallo Anna,', closing: 'LG', address: 'du' }
  );
  const sie = analyzeMail(
    'Sehr geehrter Herr Müller,\n\nanbei sende ich Ihnen das Angebot. Wenn Sie Fragen haben, melden Sie sich.\n\nMit freundlichen Grüßen\nPeter Huber\nGF'
  );
  assert.equal(sie.address, 'sie');
  assert.equal(sie.closing, 'Mit freundlichen Grüßen');
  assert.equal(analyzeMail('Danke, passt.').greeting, '');
  assert.equal(ownPart('Ok.\n\nOn Mon, 3 Nov 2026 Anna wrote:\nquoted'), 'Ok.');
  assert.equal(greetingPattern('Hallo Anna,'), 'Hallo …,');
  assert.equal(greetingPattern('Sehr geehrter Herr Müller,'), 'Sehr geehrter Herr …,');
});

test('profile per contact takes the most common habit; own addresses are not contacts', () => {
  const mails = [
    { to: 'me@x.at anna@example.com', date: '2026-11-03', text: 'Hallo Anna,\ndu bist super.\nLG' },
    { to: 'anna@example.com', date: '2026-11-02', text: 'Hi Anna,\nhast du Zeit?\nLG' },
    { to: 'anna@example.com', date: '2026-11-01', text: 'Hallo Anna,\nwie geht es dir?\nVG' },
    {
      to: 'mueller@firma.at',
      date: '2026-10-01',
      text: 'Sehr geehrter Herr Müller,\nkönnen Sie das prüfen?\nMit freundlichen Grüßen'
    }
  ];
  const p = buildProfile(mails, ['me@x.at']);
  assert.equal(p.mails, 4);
  assert.deepEqual(Object.keys(p.contacts).sort(), ['anna@example.com', 'mueller@firma.at']);
  assert.equal(p.contacts['anna@example.com'].greeting, 'Hallo Anna,');
  assert.equal(p.contacts['anna@example.com'].closing, 'LG');
  assert.equal(p.contacts['anna@example.com'].address, 'du');
  assert.equal(p.contacts['anna@example.com'].count, 3);
  assert.equal(p.contacts['mueller@firma.at'].address, 'sie');
  assert.equal(p.overall.greeting, 'Hallo …,');
});

test('learned from the encrypted index, deletable per contact and stays deleted', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-style-'));
  const key = randomBytes(32);
  const item = (fe, t, s, x, d) => ({ d, f: fe, fe, fn: fe, t, s, a: false, r: true, x, u: 1 });
  writeFileSync(
    join(dir, 'acc.lvx'),
    encrypt(key, {
      version: 1,
      identity: 'box',
      folders: {
        Sent: {
          uidValidity: '1',
          items: {
            1: item('Me@X.at', 'anna@example.com', 'Termin', 'Hallo Anna,\ndu, passt!\nLG', '2026-11-03T10:00:00Z'),
            2: item('me@x.at', 'bob@example.com', 'Re', 'Hi Bob,\nok.\nCheers', '2026-11-02T10:00:00Z'),
            3: item('me@x.at', 'xanna@example.com', 'Re', 'Hey,\nnope', '2026-11-01T10:00:00Z')
          }
        },
        INBOX: {
          uidValidity: '2',
          items: { 5: item('anna@example.com', 'me@x.at', 'Hi', 'Hallo Peter', '2026-11-04T10:00:00Z') }
        }
      },
      updatedAt: '2026-11-04T00:00:00.000Z'
    })
  );
  const index = createLocalIndex({ dir, getKey: async () => key, getIdentity: () => 'box' });
  t.after(() => {
    index.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const sent = await index.sentBy('acc', ['me@x.at']);
  assert.deepEqual(
    sent.map(m => m.uid),
    [1, 2, 3],
    'only mails the user sent, newest first'
  );
  // A recipient filter matches whole addresses only (not "xanna@…" for "anna@…").
  assert.deepEqual(await contactSamples(index, 'acc', ['me@x.at'], 'anna@example.com'), [
    'Hallo Anna,\ndu, passt!\nLG'
  ]);
  assert.deepEqual(await contactSamples(index, 'acc', ['me@x.at'], 'not an address'), []);

  let stored = { accounts: {} };
  const styles = createStyleProfiles({
    file: { get: () => stored, save: async v => (stored = v) },
    localIndex: index
  });
  await styles.learn({ id: 'acc' }, ['me@x.at']);
  assert.equal(styles.contact('acc', 'Anna@Example.com').greeting, 'Hallo Anna,');
  assert.ok(await styles.removeContact('acc', 'anna@example.com'));
  assert.equal(styles.contact('acc', 'anna@example.com'), null);
  await styles.learn({ id: 'acc' }, ['me@x.at']);
  assert.equal(styles.contact('acc', 'anna@example.com'), null, 'a deleted contact is not learned again');
  assert.ok(styles.contact('acc', 'bob@example.com'));
  await styles.clear();
  assert.deepEqual(stored, { accounts: {} });
});

test('the style profile is never part of a backup', () => {
  assert.ok(NOT_BACKED_UP['ai-style.json']);
  assert.equal(BACKUP_FILES['ai-style.json'], undefined);
});

test('a reply suggestion gets the habits and own mails for the recipient, only when learning is on', async () => {
  const handlers = {};
  let settings = { enabled: true, model: 'm', embedModel: 'e', features: {}, profile: { learnStyle: true } };
  const runs = [];
  const ai = {
    get: () => settings,
    publicSettings: () => settings,
    save: async input => (settings = { ...settings, profile: { ...settings.profile, ...input.profile } }),
    ensureAllowed: () => {},
    cloudBlocked: () => false,
    run: async (kind, input) => {
      runs.push({ kind, input });
      return { body: 'Hallo Anna' };
    },
    log: { add: async () => {} }
  };
  const detail = {
    from: [{ name: 'Anna', email: 'Anna@Example.com' }],
    to: [{ email: 'me@x.at' }],
    subject: 'Termin',
    text: 'Passt dir Montag?'
  };
  const ctx = {
    api: {
      get: (p, ...rest) => (handlers[`GET ${p}`] = rest.at(-1)),
      post: (p, ...rest) => (handlers[`POST ${p}`] = rest.at(-1))
    },
    ai,
    requireAction: () => true,
    accounts: () => [{ id: 'acc', sentFolder: 'Sent' }],
    ownAddresses: () => ['me@x.at'],
    accountAddresses: () => ['me@x.at'],
    aiForgetHooks: [],
    semantic: { search: async () => [], sync: async () => null, forget: async () => {} },
    internalRequest: async (method, url) => (url.startsWith('/api/messages?') ? { messages: [] } : detail),
    localIndex: {
      sentBy: async (_id, _own, { to } = {}) =>
        to === 'anna@example.com'
          ? [{ to, text: 'Hallo Anna,\nklar, mach ich.\nLG' }]
          : [{ to: 'anna@example.com', text: 'Hallo Anna,\ndu?\nLG' }]
    }
  };
  const { registerAiRoutes } = await import('../src/routes-ai.mjs');
  registerAiRoutes(ctx);
  const reply = { code: () => reply, send: x => x };
  await handlers['POST /api/ai/style/learn']({ body: {} }, reply);
  const out = await handlers['POST /api/ai/run'](
    { body: { kind: 'reply', account: 'acc', refs: [{ uid: 1 }] } },
    reply
  );
  const input = runs.at(-1).input;
  assert.deepEqual(input.contactStyle, { greeting: 'Hallo Anna,', closing: 'LG', address: 'du', words: 4, count: 1 });
  assert.equal(input.styleSamples[0], 'Hallo Anna,\nklar, mach ich.\nLG');
  assert.equal(out.result.styleContact, 'anna@example.com');
  const listed = await handlers['GET /api/ai/style']();
  assert.equal(listed.accounts[0].contacts[0].email, 'anna@example.com');
  // Switched off: the profile is deleted and replies use the general samples only.
  await handlers['POST /api/ai/settings']({ body: { profile: { learnStyle: false } } }, reply);
  assert.equal((await handlers['GET /api/ai/style']()).accounts[0].contacts.length, 0);
  await handlers['POST /api/ai/run']({ body: { kind: 'reply', account: 'acc', refs: [{ uid: 1 }] } }, reply);
  assert.equal(runs.at(-1).input.contactStyle, undefined);
});
