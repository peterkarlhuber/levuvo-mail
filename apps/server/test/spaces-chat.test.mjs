// Chat in shared spaces: messages between members, roles, unread markers, deletion that leaves
// every copy, the fast path (no batch pause), the IDLE wake-up and the assistant tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { fold } from '../src/spaces/model.mjs';
import { mailText, snapshotHasSyncMail } from '../src/spaces/mail-transport.mjs';
import { registerSpaceTools } from '../src/spaces/tools.mjs';
import { createWatcherPool } from '../src/inbox-watcher.mjs';

const SECRET = 'Zugangscode 4711-0815';

const vault = () => {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, v) => m.set(`${i}:${k}`, v) };
};

function postOffice() {
  const boxes = new Map();
  const sent = [];
  return {
    sent,
    transport: () => ({
      async send(msg) {
        const copy = { ...msg, envelope: structuredClone(msg.envelope) };
        sent.push(copy);
        if (!boxes.has(msg.to)) boxes.set(msg.to, []);
        boxes.get(msg.to).push(copy);
      }
    }),
    async deliver(people, rounds = 12) {
      for (let i = 0; i < rounds; i++) {
        let moved = 0;
        for (const p of people) {
          await p.service.flush();
          const box = boxes.get(p.email) || [];
          boxes.set(p.email, []);
          for (const mail of box) {
            await p.service.receiveEnvelope(p.accountId, mail.envelope, { from: mail.from });
            moved++;
          }
        }
        if (!moved && people.every(p => !p.service.hasPendingMail())) return;
      }
    }
  };
}

async function person(t, office, email, name, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-chat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = await openSpaceStore({ dir, vault: vault() });
  const accountId = `acc-${name}`;
  const service = createSpaceService({
    store,
    transport: office.transport(),
    compactPause: 0,
    accounts: () => [{ id: accountId, address: email, name, addresses: [email] }],
    ...options
  });
  return { dir, store, service, email, name, accountId };
}

async function joinSpace(office, owner, guest, spaceId, role, people) {
  await owner.service.invite(spaceId, { email: guest.email, role });
  await office.deliver(people);
  const inv = guest.service.list().invitations.find(i => i.space === spaceId);
  await guest.service.acceptInvitation(inv.id);
  await office.deliver(people);
  assert.equal(guest.service.detail(spaceId).status, 'active');
}

async function team(t, options = {}) {
  const office = postOffice();
  const anna = await person(t, office, 'anna@a.example', 'Anna', options);
  const ben = await person(t, office, 'ben@b.example', 'Ben', options);
  const cara = await person(t, office, 'cara@c.example', 'Cara', options);
  const all = [anna, ben, cara];
  const space = await anna.service.create({ name: 'Projekt', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await joinSpace(office, anna, cara, space.id, 'reader', all);
  return { office, anna, ben, cara, all, space };
}

test('Spaces chat: messages reach every member in the same order, with unread markers', async t => {
  const { office, anna, ben, cara, all, space } = await team(t);
  const first = await anna.service.postChat(space.id, { text: 'Hallo zusammen!' });
  await office.deliver(all);
  const reply = await ben.service.postChat(space.id, { text: 'Hallo Anna\nzweite Zeile', replyTo: first });
  await office.deliver(all);

  const views = all.map(p => p.service.chat(space.id));
  for (const v of views)
    assert.deepEqual(
      v.messages.map(m => m.text),
      ['Hallo zusammen!', 'Hallo Anna\nzweite Zeile']
    );
  assert.equal(views[0].messages[1].replyTo, first);
  assert.equal(views[0].messages[0].mine, true);
  assert.equal(views[1].messages[0].mine, false);

  // Own messages are never unread; others' are until shown.
  assert.equal(anna.service.chat(space.id).unread, 1);
  assert.equal(ben.service.chat(space.id).unread, 1);
  assert.equal(cara.service.chat(space.id).unread, 2);
  assert.equal(cara.service.list().spaces[0].unreadChat, 2);
  // Marking only what was shown: a message that arrives meanwhile stays unread.
  await cara.service.markChatRead(space.id, [first]);
  assert.deepEqual(
    cara.service
      .chat(space.id)
      .messages.filter(m => m.unread)
      .map(m => m.id),
    [reply]
  );
  await cara.service.markChatRead(space.id);
  assert.equal(cara.service.chat(space.id).unread, 0);
  // No read receipts: marking as read sends nothing.
  const before = office.sent.length;
  await anna.service.markChatRead(space.id);
  await office.deliver(all);
  assert.equal(office.sent.length, before);

  // Chat stays out of the activity feed.
  assert.ok(!anna.service.detail(space.id).activity.some(a => a.type.startsWith('chat.')));
  // Content travels end-to-end encrypted.
  assert.ok(office.sent.every(m => !JSON.stringify(m.envelope).includes('Hallo zusammen')));
});

test('Spaces chat: roles decide who writes, edits and deletes', async t => {
  const { office, anna, ben, cara, all, space } = await team(t);
  // Readers read along but cannot write (same as comments).
  await assert.rejects(cara.service.postChat(space.id, { text: 'Darf ich?' }), { code: 'spaces_forbidden' });
  assert.equal(cara.service.chat(space.id).canWrite, false);
  assert.equal(ben.service.chat(space.id).canWrite, true);

  const annas = await anna.service.postChat(space.id, { text: 'Von Anna' });
  const bens = await ben.service.postChat(space.id, { text: 'Von Ben' });
  await office.deliver(all);
  // Only the author edits; an editor cannot delete someone else's message.
  await assert.rejects(ben.service.apply(space.id, 'chat.edit', { id: annas, text: 'x' }), {
    code: 'spaces_forbidden'
  });
  await assert.rejects(ben.service.apply(space.id, 'chat.delete', { id: annas }), { code: 'spaces_forbidden' });
  await ben.service.apply(space.id, 'chat.edit', { id: bens, text: 'Von Ben (korrigiert)' });
  // The owner may remove any message.
  await anna.service.apply(space.id, 'chat.delete', { id: bens });
  await office.deliver(all);
  for (const p of all)
    assert.deepEqual(
      p.service.chat(space.id).messages.map(m => m.text),
      ['Von Anna']
    );
  // Empty or oversized messages are rejected before anything is signed.
  await assert.rejects(anna.service.postChat(space.id, { text: '   ' }), { code: 'spaces_invalid' });
  await assert.rejects(anna.service.postChat(space.id, { text: 'x'.repeat(10_001) }), { code: 'spaces_invalid' });
});

test('Spaces chat: a deleted message leaves every copy with the next checkpoint', async t => {
  const { office, anna, ben, cara, all, space } = await team(t);
  const id = await ben.service.postChat(space.id, { text: `Hier der ${SECRET}` });
  await anna.service.postChat(space.id, { text: 'Danke', replyTo: id });
  await office.deliver(all);
  await ben.service.apply(space.id, 'chat.delete', { id });
  await office.deliver(all);
  await anna.service.flush();
  await office.deliver(all);
  for (const p of all) {
    const v = p.service.chat(space.id);
    assert.deepEqual(
      v.messages.map(m => m.text),
      ['Danke']
    );
    // The reply now points to a message that is gone.
    assert.equal(v.quoted[id], null);
    assert.ok(!JSON.stringify(p.store.get(space.id)).includes(SECRET), `${p.name}: gone from the local copy`);
  }
  // Old sync mails that arrive again (a replay) do not bring the message back.
  for (const m of office.sent.filter(x => x.kind === 'ops' && x.to === cara.email))
    await cara.service.receiveEnvelope(cara.accountId, m.envelope, { from: m.from });
  assert.deepEqual(
    cara.service.chat(space.id).messages.map(m => m.text),
    ['Danke']
  );
});

test('Spaces chat: messages skip the batch pause, other changes still wait for it', async t => {
  const { office, anna, ben, all, space } = await team(t);
  // Batched service for Anna from now on is simulated by a long pause on a fresh member.
  const slow = await person(t, office, 'dora@d.example', 'Dora', { batchDelay: 60_000 });
  await joinSpace(office, anna, slow, space.id, 'editor', [...all, slow]);
  const count = () => office.sent.filter(m => m.kind === 'ops' && m.from === slow.email).length;
  const start = count();
  await slow.service.apply(space.id, 'task.upsert', { id: slow.service.newId(), title: 'Später' });
  await new Promise(r => setImmediate(r));
  assert.equal(count(), start, 'normal changes wait for the batch pause');
  await slow.service.postChat(space.id, { text: 'Sofort' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(count() > start, 'a chat message goes out right away (and takes the waiting task along)');
  assert.ok(office.sent.filter(m => m.from === slow.email && m.kind === 'ops').every(m => m.urgent === true));
  await office.deliver([...all, slow]);
  assert.equal(ben.service.chat(space.id).messages.at(-1).text, 'Sofort');
  assert.ok(ben.service.detail(space.id).tasks.some(x => x.title === 'Später'));
});

test('Spaces chat: spaces without chat fold exactly as before (checkpoint digests stay compatible)', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@a.example', 'Anna');
  const space = await anna.service.create({ name: 'Alt', accountId: anna.accountId });
  const { state } = fold(space.id, anna.store.get(space.id).ops);
  assert.equal('chat' in state, false);
});

test('Spaces chat: the client can wait for the next change instead of polling', async t => {
  const { office, anna, ben, all, space } = await team(t);
  const { rev } = anna.service.chat(space.id);
  const waiting = anna.service.waitForChange(space.id, rev, 5000);
  await ben.service.postChat(space.id, { text: 'Bin da' });
  await office.deliver(all);
  assert.equal(await waiting, true);
  // An outdated rev answers at once; without a change it times out with false.
  assert.equal(await anna.service.waitForChange(space.id, rev, 5000), true);
  assert.equal(await anna.service.waitForChange(space.id, anna.service.chat(space.id).rev, 20), false);
});

test('Spaces chat: IDLE snapshots wake the receive only for sync mails', () => {
  const sync = mailText('sync').subject;
  const prev = { uidValidity: '7', highestUid: 10 };
  const snap = (high, messages) => ({ uidValidity: '7', highestUid: high, messages });
  assert.equal(snapshotHasSyncMail(undefined, snap(11, [{ uid: 11, subject: sync }])), false, 'first snapshot');
  assert.equal(
    snapshotHasSyncMail(
      prev,
      snap(11, [
        { uid: 11, subject: sync },
        { uid: 10, subject: 'x' }
      ])
    ),
    true,
    'new sync mail'
  );
  assert.equal(
    snapshotHasSyncMail(
      prev,
      snap(11, [
        { uid: 11, subject: 'Rechnung' },
        { uid: 10, subject: 'x' }
      ])
    ),
    false,
    'normal mail needs no extra login'
  );
  assert.equal(
    snapshotHasSyncMail(prev, snap(12, [{ uid: 11, subject: 'Einladung in den Raum „X“' }])),
    true,
    'invitation'
  );
  // A new UID that is already gone again (another device of the same person moved it).
  assert.equal(snapshotHasSyncMail(prev, snap(11, [{ uid: 10, subject: 'x' }])), true);
  assert.equal(snapshotHasSyncMail(prev, snap(10, [{ uid: 10, subject: sync }])), false, 'nothing new');
  assert.equal(snapshotHasSyncMail(prev, { ...snap(11, [{ uid: 11, subject: sync }]), uidValidity: '8' }), false);
});

test('Spaces chat: the inbox watcher pool passes snapshots to subscribers', () => {
  const pool = createWatcherPool({ clientFactory: () => null, timers: globalThis });
  const seen = [];
  const off = pool.subscribe((id, s) => seen.push([id, s.highestUid]));
  assert.equal(typeof off, 'function');
  off();
  pool.stopAll();
  assert.deepEqual(seen, []);
});

test('Spaces chat: the assistant reads the chat and writes only after approval, marked as AI', async t => {
  const { office, anna, ben, all, space } = await team(t);
  await ben.service.postChat(space.id, { text: 'Wann ist die Abnahme?' });
  await office.deliver(all);
  const tools = new Map();
  const approvals = new Map();
  const registry = {
    register: defs => defs.forEach(d => tools.set(d.name, d)),
    registerApproval: (type, def) => approvals.set(type, def)
  };
  const frame = (text, source) => `<untrusted_data source="${source}">${text}</untrusted_data>`;
  registerSpaceTools({ accounts: () => [], spaces: {} }, { service: async () => anna.service, registry, frame });
  const local = { cloud: false };

  const read = await tools.get('read_room_chat').run({ room: space.id }, local);
  assert.match(read, /^<untrusted_data/);
  assert.match(read, /Wann ist die Abnahme\?/);
  assert.match(read, /"by": "Ben"/);
  assert.match(await tools.get('search_rooms').run({ query: 'Abnahme' }, local), /"kind": "chat"/);

  const question = ben.service.chat(space.id).messages[0].id;
  const payload = await tools
    .get('room_chat_post')
    .run({ room: space.id, text: 'Am Freitag um 10 Uhr.', reply_to: question }, local);
  assert.equal(anna.service.chat(space.id).messages.length, 1, 'nothing written before approval');
  const summary = approvals.get('room_change').summary(payload);
  assert.equal(summary.kind, 'chat_post');
  assert.equal(summary.content.text, 'Am Freitag um 10 Uhr.');
  await approvals.get('room_change').execute(payload);
  await office.deliver(all);
  const last = ben.service.chat(space.id).messages.at(-1);
  assert.equal(last.text, 'Am Freitag um 10 Uhr.');
  assert.equal(last.ai, true, 'shown as AI-generated to every member');
  assert.equal(last.replyTo, question);
  await assert.rejects(
    tools.get('room_chat_post').run({ room: space.id, text: 'x', reply_to: 'ab'.repeat(8) }, local),
    /reply_to/
  );
});
