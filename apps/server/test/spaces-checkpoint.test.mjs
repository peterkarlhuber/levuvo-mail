// Checkpoints in shared spaces (internal audit 2026-11-19): deleted content leaves every copy and
// never reaches members who join later (DB-LEV-002), the operation log stays bounded (ARC-LEV-004),
// and many quick changes travel as one mail per member (PERF-LEV-004).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { identityKeys, open, seal, signed, unb64u } from '../src/spaces/crypto.mjs';

const SECRET = 'Kontonummer AT61 1904 3002 3457 3201';

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
    },
    drop(email) {
      boxes.set(email, []);
    }
  };
}

async function person(t, office, email, name, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-cp-'));
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

async function joinSpace(office, owner, guest, spaceId, people) {
  await owner.service.invite(spaceId, { email: guest.email });
  await office.deliver(people);
  const inv = guest.service.list().invitations.find(i => i.space === spaceId);
  await guest.service.acceptInvitation(inv.id);
  await office.deliver(people);
  assert.equal(guest.service.detail(spaceId).status, 'active');
}

/** Everything a member stores about a space, as text (the decrypted record). */
const recordText = (p, spaceId) => JSON.stringify(p.store.get(spaceId));

/** Plain text of every envelope a member received (decrypted with the space or box key). */
function receivedText(office, p, spaceId) {
  const keys = identityKeys(p.store.identity);
  const r = p.store.get(spaceId);
  return office.sent
    .filter(m => m.to === p.email && m.envelope.t !== 'invite')
    .map(m => {
      const env = m.envelope;
      try {
        if (env.t === 'sealed')
          return open(unb64u(r.keys[env.epoch]), env.box, `space.${spaceId}.${env.epoch}`).toString('utf8');
        if (env.t === 'boxed') return open(keys.unwrap(env.wrap), env.box, `boxed.${spaceId}.${keys.id}`).toString();
      } catch {}
      return '';
    })
    .join('\n');
}

async function filledSpace(anna) {
  const space = await anna.service.create({ name: 'Kunde Müller', accountId: anna.accountId });
  const mailId = anna.service.newId();
  await anna.service.apply(space.id, 'mail.add', {
    id: mailId,
    subject: 'Bankdaten',
    from: { name: 'Kunde', address: 'kunde@example.org' },
    text: `Bitte überweisen an ${SECRET}`
  });
  const commentId = anna.service.newId();
  await anna.service.apply(space.id, 'comment.add', {
    id: commentId,
    target: { kind: 'mail', id: mailId },
    text: `Notiz: ${SECRET}`
  });
  const taskId = anna.service.newId();
  await anna.service.apply(space.id, 'task.upsert', { id: taskId, title: `Prüfen ${SECRET}` });
  const fileId = await anna.service.addFile(space.id, {
    name: 'konto.txt',
    data: Buffer.from(`Datei mit ${SECRET}`)
  });
  return { space, mailId, commentId, taskId, fileId };
}
const deleteAll = async (p, spaceId, ids) => {
  await p.service.apply(spaceId, 'comment.delete', { id: ids.commentId });
  await p.service.apply(spaceId, 'mail.remove', { id: ids.mailId });
  await p.service.apply(spaceId, 'task.delete', { id: ids.taskId });
  await p.service.apply(spaceId, 'file.delete', { id: ids.fileId });
};
const blobFiles = p => readdirSync(join(p.dir, 'blobs'), { withFileTypes: true }).filter(f => f.isFile()).length;

test('DB-LEV-002: content deleted before someone joins is never sent to them', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@x.example', 'Anna');
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const ids = await filledSpace(anna);
  const { space } = ids;
  assert.ok(blobFiles(anna) > 0);
  await deleteAll(anna, space.id, ids);
  // A task that stays, and a note.
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Angebot schicken' });
  await anna.service.createNote(space.id, { title: 'Protokoll', text: 'Fenster bis Montag' });

  await joinSpace(office, anna, ben, space.id, [anna, ben]);
  const detail = ben.service.detail(space.id);
  assert.deepEqual(
    detail.tasks.map(x => x.title),
    ['Angebot schicken']
  );
  assert.equal(detail.notes[0].text, 'Fenster bis Montag');
  assert.equal(detail.mails.length, 0);
  assert.ok(!receivedText(office, ben, space.id).includes('AT61'), 'never sent to the new member');
  assert.ok(!recordText(ben, space.id).includes('AT61'), 'not in their copy');
  // The owner's own copy lost it too, and the file parts are gone from the disk.
  assert.ok(!recordText(anna, space.id).includes('AT61'));
  assert.equal(blobFiles(anna), 0);
  // Both agree on what is there.
  assert.deepEqual(ben.service.detail(space.id).tasks, anna.service.detail(space.id).tasks);
});

test('DB-LEV-002: content deleted later leaves every member copy', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@x.example', 'Anna');
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const space = await anna.service.create({ name: 'Projekt', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, [anna, ben]);
  // Ben adds the sensitive things, Ben (an editor) deletes them again.
  const ids = await filledSpace({ ...ben, service: { ...ben.service, create: async () => space } });
  await office.deliver([anna, ben]);
  assert.ok(recordText(anna, space.id).includes('AT61'));
  await deleteAll(ben, space.id, ids);
  await office.deliver([anna, ben]);
  for (const p of [anna, ben]) {
    assert.ok(!recordText(p, space.id).includes('AT61'), `${p.name}'s copy is clean`);
    assert.equal(blobFiles(p), 0, `${p.name}'s file parts are gone`);
    assert.equal(p.service.detail(space.id).comments.length, 0);
    // The activity list keeps who did what, not the titles.
    assert.ok(!JSON.stringify(p.service.detail(space.id).activity).includes('AT61'));
  }
});

test('ARC-LEV-004: the log is cut at checkpoints and members stay in step; a lagging member catches up', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@x.example', 'Anna');
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const cara = await person(t, office, 'cara@z.example', 'Cara');
  const all = [anna, ben, cara];
  const space = await anna.service.create({ name: 'Viel los', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, all);
  await joinSpace(office, anna, cara, space.id, all);
  const task = ben.service.newId();
  for (let i = 0; i < 520; i++) await ben.service.apply(space.id, 'task.upsert', { id: task, title: `Stand ${i}` });
  // Cara misses everything.
  await ben.service.flush();
  office.drop(cara.email);
  await office.deliver([anna, ben]);
  for (const p of [anna, ben]) {
    assert.ok(p.store.get(space.id).ops.length < 100, `${p.name}'s log was cut`);
    assert.equal(p.service.detail(space.id).tasks[0].title, 'Stand 519');
  }
  // Cara asks; she gets the checkpoint instead of history the others no longer have.
  await cara.service.resync(space.id);
  await office.deliver(all);
  assert.equal(cara.service.detail(space.id).tasks[0].title, 'Stand 519');
  assert.ok(cara.store.get(space.id).ops.length < 100);
  // Later changes still arrive everywhere.
  await cara.service.apply(space.id, 'task.upsert', { id: task, status: 'done' });
  await office.deliver(all);
  for (const p of all) assert.equal(p.service.detail(space.id).tasks[0].status, 'done');
});

test('ARC-LEV-004: a checkpoint that does not match the own ops is not taken over', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@x.example', 'Anna');
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const space = await anna.service.create({ name: 'Prüfung', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, [anna, ben]);
  const id = ben.service.newId();
  await ben.service.apply(space.id, 'task.upsert', { id, title: 'Echt' });
  await office.deliver([anna, ben]);
  const opsBefore = ben.store.get(space.id).ops.length;
  // The owner's key signs a checkpoint whose digest belongs to another state.
  const annaKeys = identityKeys(anna.store.identity);
  const r = anna.store.get(space.id);
  const header = signed(annaKeys, {
    v: 1,
    t: 'checkpoint',
    space: space.id,
    by: annaKeys.id,
    vv: { ...ben.store.get(space.id).base.header.vv, [identityKeys(ben.store.identity).id]: 1 },
    lc: 99,
    digest: 'f'.repeat(64),
    at: new Date().toISOString()
  });
  const env = signed(annaKeys, {
    v: 1,
    t: 'sealed',
    space: space.id,
    from: annaKeys.id,
    epoch: r.epoch,
    box: seal(unb64u(r.keys[r.epoch]), JSON.stringify({ t: 'checkpoint', header }), `space.${space.id}.${r.epoch}`)
  });
  assert.equal(await ben.service.receiveEnvelope(ben.accountId, env), 'ok');
  assert.equal(ben.store.get(space.id).ops.length, opsBefore, 'own log kept');
  assert.equal(ben.service.detail(space.id).tasks[0].title, 'Echt');
  // A member cannot make checkpoints at all.
  const benKeys = identityKeys(ben.store.identity);
  const forged = signed(benKeys, { ...header, by: benKeys.id });
  const env2 = signed(benKeys, {
    v: 1,
    t: 'sealed',
    space: space.id,
    from: benKeys.id,
    epoch: r.epoch,
    box: seal(
      unb64u(r.keys[r.epoch]),
      JSON.stringify({ t: 'checkpoint', header: forged, part: 0, parts: 1, data: '{}' }),
      `space.${space.id}.${r.epoch}`
    )
  });
  await anna.service.receiveEnvelope(anna.accountId, env2);
  assert.equal(anna.store.get(space.id).base.header.by, annaKeys.id);
});

test('PERF-LEV-004: quick changes travel as one mail per member', async t => {
  const office = postOffice();
  const anna = await person(t, office, 'anna@x.example', 'Anna', { batchDelay: 60_000 });
  const ben = await person(t, office, 'ben@y.example', 'Ben');
  const space = await anna.service.create({ name: 'Notizen', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, [anna, ben]);
  const before = office.sent.length;
  const task = anna.service.newId();
  for (let i = 0; i < 20; i++) await anna.service.apply(space.id, 'task.upsert', { id: task, title: `Fassung ${i}` });
  // Nothing went out yet: the changes wait for the batch.
  assert.equal(office.sent.length, before);
  await anna.service.flush();
  const mails = office.sent.slice(before).filter(m => m.to === ben.email && m.kind === 'ops');
  assert.equal(mails.length, 1);
  await office.deliver([anna, ben]);
  assert.equal(ben.service.detail(space.id).tasks[0].title, 'Fassung 19');
  // And nothing in the raw sync files of the data folder mentions the content.
  for (const f of readdirSync(anna.dir).filter(f => f.endsWith('.lvs')))
    assert.ok(!readFileSync(join(anna.dir, f), 'utf8').includes('Fassung'));
});
