import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMailStore } from './helpers/fake-mailstore.mjs';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { buildSyncMail, createMailTransport, parseSyncMail, SPACES_FOLDER } from '../src/spaces/mail-transport.mjs';
import { roomOverview, searchRoom } from '../src/spaces/tools.mjs';

const vault = () => {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, v) => m.set(`${i}:${k}`, v) };
};

/** Two people at different providers; SMTP delivers straight into the other's INBOX. */
async function setup(t) {
  const mailboxes = new Map();
  const people = [];
  for (const [email, name] of [
    ['anna@hetzner.example', 'Anna'],
    ['ben@m365.example', 'Ben']
  ]) {
    const mail = createMailStore({ folders: ['INBOX', 'Sent', 'Junk'] });
    mailboxes.set(email, mail);
    const account = {
      id: `acc-${name}`,
      displayName: name,
      imap: { user: email, configured: true },
      smtp: { user: email, configured: true },
      identities: []
    };
    const sentRaw = [];
    const ctx = {
      accounts: () => [account],
      accountAddresses: a => [a.imap.user],
      fromFor: (a, from) => ({ name: a.displayName, address: from || a.imap.user }),
      smtpConfigFor: async a => a.smtp,
      smtpFactory: () => ({
        async sendMail({ raw, envelope }) {
          sentRaw.push(raw);
          for (const to of envelope.to) mailboxes.get(to)?.add('INBOX', raw);
          return { accepted: envelope.to, rejected: [] };
        },
        close() {}
      }),
      withImap: async (fn, _account) => fn(mail.client({ name }))
    };
    const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-mail-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = await openSpaceStore({ dir, vault: vault() });
    const transport = createMailTransport(ctx, store);
    const service = createSpaceService({
      store,
      transport,
      accounts: () => [{ id: account.id, address: email, name, addresses: [email] }]
    });
    const sync = async () => {
      const n = await transport.receive(account.id, (env, from) => service.receiveEnvelope(account.id, env, { from }));
      await service.flush();
      return n;
    };
    people.push({ email, name, account, mail, service, sync, sentRaw });
  }
  const syncAll = async (rounds = 6) => {
    for (let i = 0; i < rounds; i++) for (const p of people) await p.sync();
  };
  return { people, syncAll };
}

test('Spaces over mail: invite, join and sync through real MIME mails into a hidden folder', async t => {
  const { people, syncAll } = await setup(t);
  const [anna, ben] = people;
  const space = await anna.service.create({ name: 'Kunde Müller', accountId: anna.account.id });
  await anna.service.invite(space.id, { email: ben.email, role: 'editor' });
  await anna.service.flush();
  // The invitation is a readable mail with the space name, but no keys or content.
  const invite = ben.mail.messages('INBOX')[0].source.toString();
  assert.match(invite, /X-Levuvo-Space: v1; invite/);
  await syncAll(1);
  const inv = ben.service.list().invitations[0];
  assert.equal(inv.name, 'Kunde Müller');
  assert.equal(inv.from.email, anna.email);
  assert.equal(ben.mail.messages('INBOX').length, 0, 'sync mails leave the inbox');
  await ben.service.acceptInvitation(inv.id);
  await syncAll();
  assert.equal(ben.service.detail(space.id).status, 'active');

  const id = ben.service.newId();
  await ben.service.apply(space.id, 'task.upsert', { id, title: 'Angebot prüfen' });
  await syncAll();
  assert.equal(anna.service.detail(space.id).tasks[0].title, 'Angebot prüfen');

  // Inboxes stay clean, transport mails sit in the hidden folder, nothing lands in "Sent".
  for (const p of people) {
    assert.equal(p.mail.messages('INBOX').length, 0);
    assert.equal(p.mail.messages('Sent').length, 0);
    assert.ok(p.mail.box(`INBOX/${SPACES_FOLDER}`) || p.mail.box(SPACES_FOLDER));
  }
  // No content in any raw mail.
  for (const raw of [...anna.sentRaw, ...ben.sentRaw]) assert.ok(!raw.toString().includes('Angebot'));
});

test('Spaces over mail: sync mails filtered into junk are found too; fake ones stay', async t => {
  const { people, syncAll } = await setup(t);
  const [anna, ben] = people;
  const space = await anna.service.create({ name: 'Spam-Test', accountId: anna.account.id });
  await anna.service.invite(space.id, { email: ben.email });
  await anna.service.flush();
  // Simulate a spam filter moving it.
  const [msg] = ben.mail.messages('INBOX');
  ben.mail.box('INBOX').messages.delete(msg.uid);
  ben.mail.add('Junk', msg.source);
  // A mail that only pretends to be a sync mail.
  ben.mail.add('INBOX', 'From: x@evil.example\r\nX-Levuvo-Space: v1; sync\r\nSubject: hi\r\n\r\nno attachment\r\n');
  await syncAll(1);
  assert.equal(ben.service.list().invitations.length, 1);
  assert.equal(ben.mail.messages('Junk').length, 0);
  assert.equal(ben.mail.messages('INBOX').length, 1, 'fake sync mail is left alone');
});

test('Spaces over mail: MIME round trip and assistant helpers', async () => {
  const raw = await buildSyncMail({
    from: 'a@x.example',
    to: 'b@y.example',
    kind: 'sync',
    envelope: { v: 1, t: 'sealed', data: 'x'.repeat(10) }
  });
  assert.match(raw.toString(), /Auto-Submitted: auto-generated/);
  const parsed = await parseSyncMail(raw);
  assert.equal(parsed.envelope.t, 'sealed');
  assert.equal(parsed.from, 'a@x.example');
  const detail = {
    id: 'r1',
    name: 'R',
    description: '',
    role: 'owner',
    members: [{ id: 'm1', name: 'Anna', email: 'a@x', role: 'owner' }],
    notes: [{ id: 'n1', title: 'Protokoll', text: 'Fenster bestellen bis Montag', updatedBy: 'm1' }],
    tasks: [{ id: 't1', title: 'Elektriker anrufen', status: 'open', assignee: 'm1', notes: '' }],
    events: [],
    mails: [],
    comments: [],
    files: []
  };
  assert.equal(roomOverview(detail).tasks[0].assignee, 'Anna');
  assert.deepEqual(
    searchRoom(detail, 'fenster').map(h => h.source),
    [{ room: 'r1', kind: 'note', id: 'n1' }]
  );
});

test('Spaces tools: reads are framed, changes wait for approval, cloud agents see only allowed spaces', async t => {
  const { people } = await setup(t);
  const [anna] = people;
  const { registerSpaceTools } = await import('../src/spaces/tools.mjs');
  const tools = new Map();
  const approvals = new Map();
  const registry = {
    register: defs => defs.forEach(d => tools.set(d.name, d)),
    registerApproval: (type, def) => approvals.set(type, def)
  };
  const frame = (text, source) => `<untrusted_data source="${source}">${text}</untrusted_data>`;
  const ctx = { accounts: () => [anna.account], spaces: { addMail: async () => ({ id: 'x' }) } };
  registerSpaceTools(ctx, { service: async () => anna.service, registry, frame });
  const space = await anna.service.create({ name: 'Kunde Müller', accountId: anna.account.id });
  const local = { cloud: false };
  const cloud = { cloud: true };

  // Never offered: dissolving, deleting, keys, assistant settings.
  for (const name of tools.keys()) assert.doesNotMatch(name, /dissolve|delete|key|setting/);
  assert.ok(tools.get('room_add_task').approval === 'room_change');
  assert.equal(tools.get('room_invite').level, 'full');

  const listed = await tools.get('list_rooms').run({}, local);
  assert.match(listed, /^<untrusted_data/);
  assert.match(listed, /Kunde Müller/);
  // Cloud models only see spaces whose owner allowed it (default: not allowed).
  assert.doesNotMatch(await tools.get('list_rooms').run({}, cloud), /Kunde Müller/);
  await assert.rejects(tools.get('read_room').run({ room: space.id }, cloud), /not available/);
  await anna.service.apply(space.id, 'ai.settings', { cloudAllowed: true });
  assert.match(await tools.get('list_rooms').run({}, cloud), /Kunde Müller/);

  // A change is only a payload until the user approves it.
  const payload = await tools
    .get('room_add_task')
    .run({ room: 'Kunde Müller', title: 'Angebot schicken', assignee: anna.email }, local);
  assert.equal(anna.service.detail(space.id).tasks.length, 0);
  assert.match(approvals.get('room_change').summary(payload).title, /Kunde Müller.*Angebot schicken/);
  await approvals.get('room_change').execute(payload);
  assert.equal(anna.service.detail(space.id).tasks[0].title, 'Angebot schicken');

  // The owner can switch the assistant off for a space.
  await anna.service.apply(space.id, 'ai.settings', { enabled: false });
  assert.doesNotMatch(await tools.get('list_rooms').run({}, local), /Kunde Müller/);
});
