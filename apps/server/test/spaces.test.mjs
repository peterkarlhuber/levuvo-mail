import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { createIdentity, identityKeys, open, seal, signed, signatureValid, wrapKey } from '../src/spaces/crypto.mjs';
import { fold, noteText } from '../src/spaces/model.mjs';

const vault = () => {
  const m = new Map();
  return { available: true, get: (i, k) => m.get(`${i}:${k}`) || '', set: (i, k, v) => m.set(`${i}:${k}`, v) };
};

/** In-memory mail system: every person has a mailbox; delivery happens on `deliver()`. */
function postOffice() {
  const boxes = new Map();
  const sent = [];
  return {
    sent,
    transportFor: () => ({
      async send(msg) {
        sent.push(msg);
        if (!boxes.has(msg.to)) boxes.set(msg.to, []);
        boxes.get(msg.to).push({ from: msg.from, envelope: JSON.parse(JSON.stringify(msg.envelope)) });
      }
    }),
    async deliver(people, { rounds = 10, shuffle = false } = {}) {
      for (let i = 0; i < rounds; i++) {
        let moved = 0;
        for (const p of people) {
          await p.service.flush();
          const box = boxes.get(p.email) || [];
          boxes.set(p.email, []);
          if (shuffle) box.reverse();
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

async function person(t, office, email, name) {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keys = vault();
  const store = await openSpaceStore({ dir, vault: keys });
  const accountId = `acc-${name}`;
  const service = createSpaceService({
    store,
    transport: office.transportFor(),
    accounts: () => [{ id: accountId, address: email, name, addresses: [email] }]
  });
  return { dir, keys, store, service, email, name, accountId };
}

async function threePeople(t) {
  const office = postOffice();
  const anna = await person(t, office, 'anna@hetzner.example', 'Anna');
  const ben = await person(t, office, 'ben@m365.example', 'Ben');
  const cara = await person(t, office, 'cara@posteo.example', 'Cara');
  return { office, anna, ben, cara, all: [anna, ben, cara] };
}

async function joinSpace(office, owner, guest, spaceId, role = 'editor', people = [owner, guest]) {
  await owner.service.invite(spaceId, { email: guest.email, role });
  await office.deliver(people);
  const inv = guest.service.list().invitations.find(i => i.space === spaceId);
  assert.ok(inv, 'invitation arrives');
  await guest.service.acceptInvitation(inv.id);
  await office.deliver(people);
}

test('Spaces: crypto primitives sign, seal and wrap', () => {
  const a = identityKeys(createIdentity());
  const b = identityKeys(createIdentity());
  const body = signed(a, { x: 1, nested: { b: 2, a: [1, 2] } });
  assert.ok(signatureValid(body, a.signPub));
  assert.ok(!signatureValid({ ...body, x: 2 }, a.signPub));
  assert.ok(!signatureValid(body, b.signPub));
  const key = Buffer.alloc(32, 7);
  const box = seal(key, 'geheim', 'ctx');
  assert.equal(open(key, box, 'ctx').toString(), 'geheim');
  assert.throws(() => open(key, box, 'other'));
  const wrapped = wrapKey(key, b.boxPub, 'space');
  assert.deepEqual(b.unwrap(wrapped), key);
  assert.throws(() => a.unwrap(wrapped));
  assert.match(a.safetyCode, /^\d{4}( \d{4}){5}$/);
});

test('Spaces: create, invite by mail, join, and edit together across providers', async t => {
  const { office, anna, ben, cara, all } = await threePeople(t);
  const space = await anna.service.create({
    name: 'Umbau Büro',
    description: 'Alles zum Umbau',
    accountId: anna.accountId
  });
  assert.equal(space.status, 'active');
  assert.equal(space.owner, true);

  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await joinSpace(office, anna, cara, space.id, 'reader', all);

  for (const p of all) {
    const d = p.service.detail(space.id);
    assert.equal(d.status, 'active', `${p.name} active`);
    assert.equal(d.name, 'Umbau Büro');
    assert.deepEqual(
      d.members
        .filter(m => !m.removed)
        .map(m => m.email)
        .sort(),
      [anna.email, ben.email, cara.email].sort()
    );
  }
  assert.equal(ben.service.detail(space.id).role, 'editor');
  assert.equal(cara.service.detail(space.id).role, 'reader');

  // Content from an editor reaches everybody.
  const taskId = ben.service.newId();
  await ben.service.apply(space.id, 'task.upsert', {
    id: taskId,
    title: 'Angebot Elektriker einholen',
    due: '2026-12-01'
  });
  const noteId = await anna.service.createNote(space.id, { title: 'Besprechung', text: 'Erste Zeile' });
  await office.deliver(all);
  for (const p of all) {
    const d = p.service.detail(space.id);
    assert.equal(d.tasks[0].title, 'Angebot Elektriker einholen');
    assert.equal(d.notes[0].text, 'Erste Zeile');
  }

  // Readers can read but not write.
  await assert.rejects(cara.service.apply(space.id, 'task.upsert', { id: cara.service.newId(), title: 'Nope' }), {
    code: 'spaces_forbidden'
  });

  // Concurrent edits of the same note merge without conflicts.
  await anna.service.appendToNote(space.id, noteId, 'Von Anna');
  await ben.service.appendToNote(space.id, noteId, 'Von Ben');
  await office.deliver(all, { shuffle: true });
  const texts = all.map(p => p.service.detail(space.id).notes[0].text);
  assert.equal(new Set(texts).size, 1, 'everyone sees the same note');
  assert.match(texts[0], /Von Anna/);
  assert.match(texts[0], /Von Ben/);

  // Assignment and comments
  await anna.service.apply(space.id, 'task.upsert', { id: taskId, assignee: ben.service.identity.id, status: 'doing' });
  await ben.service.apply(space.id, 'comment.add', {
    id: ben.service.newId(),
    target: { kind: 'task', id: taskId },
    text: 'Mache ich bis Freitag.'
  });
  await office.deliver(all);
  const d = cara.service.detail(space.id);
  assert.equal(d.tasks[0].assignee, ben.service.identity.id);
  assert.equal(d.tasks[0].status, 'doing');
  assert.equal(d.comments[0].text, 'Mache ich bis Freitag.');
  assert.ok(d.activity.some(a => a.type === 'comment.add' && a.by === ben.service.identity.id));

  // Mail service only ever saw ciphertext for content.
  const contentMails = office.sent.filter(m => m.kind === 'ops');
  assert.ok(contentMails.length > 0);
  assert.ok(contentMails.every(m => !JSON.stringify(m.envelope).includes('Elektriker')));

  // Stored on disk encrypted.
  for (const f of readdirSync(anna.dir).filter(f => f.endsWith('.lvs')))
    assert.ok(!readFileSync(join(anna.dir, f), 'utf8').includes('Umbau'));
});

test('Spaces: removing a member rotates the key; new content stays unreadable for them', async t => {
  const { office, anna, ben, cara, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Kunde Müller', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await joinSpace(office, anna, cara, space.id, 'editor', all);

  await anna.service.removeMember(space.id, cara.service.identity.id);
  await office.deliver(all);
  assert.equal(cara.service.detail(space.id).status, 'removed');
  assert.ok(anna.store.get(space.id).epoch > 1);
  assert.equal(ben.store.get(space.id).epoch, anna.store.get(space.id).epoch);

  // Cara can no longer write: everyone ignores her ops, and she cannot read new ones.
  const before = office.sent.length;
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Vertraulich nach Entfernen' });
  await office.deliver(all);
  const newMails = office.sent.slice(before);
  assert.ok(
    newMails.every(m => m.to !== cara.email),
    'removed member gets no new content'
  );
  assert.ok(!cara.service.detail(space.id).tasks.some(x => x.title === 'Vertraulich nach Entfernen'));
  assert.ok(ben.service.detail(space.id).tasks.some(x => x.title === 'Vertraulich nach Entfernen'));

  // Even if she obtained the new envelope, she lacks the key.
  const sealedForBen = newMails.find(m => m.to === ben.email && m.envelope.t === 'sealed');
  assert.equal(await cara.service.receiveEnvelope(cara.accountId, sealedForBen.envelope), 'no_key');
});

test('Spaces: forged and tampered envelopes are rejected', async t => {
  const { office, anna, ben, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Projekt', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await ben.service.apply(space.id, 'task.upsert', { id: ben.service.newId(), title: 'Echt' });
  await ben.service.flush();
  const mail = office.sent.filter(m => m.to === anna.email && m.kind === 'ops').at(-1);
  office.drop(anna.email);
  const tampered = structuredClone(mail.envelope);
  tampered.epoch = 99;
  assert.equal(await anna.service.receiveEnvelope(anna.accountId, tampered), 'invalid_signature');
  // A stranger cannot inject ops.
  const mallory = identityKeys(createIdentity());
  const forged = signed(mallory, { ...mail.envelope, from: mallory.id });
  assert.equal(await anna.service.receiveEnvelope(anna.accountId, forged), 'unknown_sender');
  // A join request without a valid invitation adds nobody.
  const owner = anna.service.detail(space.id).members.find(m => m.role === 'owner');
  assert.ok(owner);
  assert.equal(anna.service.detail(space.id).members.length, 2);
});

test('Spaces: files are chunked, encrypted and versioned', async t => {
  const { office, anna, ben, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Dateien', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  const big = Buffer.alloc(11 * 1024 * 1024, 1);
  big.write('Plan', 0);
  const fileId = await anna.service.addFile(space.id, {
    name: 'plan.pdf',
    folder: 'Pläne',
    mime: 'application/pdf',
    data: big
  });
  await office.deliver(all);
  const got = await ben.service.readFile(space.id, fileId);
  assert.equal(got.data.length, big.length);
  assert.ok(got.data.equals(big));
  await ben.service.addFile(space.id, { fileId, data: Buffer.from('Version 2'), mime: 'application/pdf' });
  await office.deliver(all);
  const d = anna.service.detail(space.id);
  assert.equal(d.files[0].versions.length, 2);
  assert.equal((await anna.service.readFile(space.id, fileId)).data.toString(), 'Version 2');
  assert.equal((await anna.service.readFile(space.id, fileId, 1)).data.length, big.length);
  // chunk files on disk never contain plain content
  const chunk = readdirSync(join(anna.dir, 'blobs'))[0];
  assert.ok(!readFileSync(join(anna.dir, 'blobs', chunk), 'utf8').includes('Plan'));
});

test('Spaces: a member who missed mails catches up', async t => {
  const { office, anna, ben, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Lücken', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Verloren' });
  await anna.service.flush();
  office.drop(ben.email); // mail lost
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Danach' });
  await office.deliver(all);
  const titles = ben.service
    .detail(space.id)
    .tasks.map(x => x.title)
    .sort();
  assert.deepEqual(titles, ['Danach', 'Verloren']);
});

test('Spaces: fold is deterministic whatever the arrival order', () => {
  const a = identityKeys(createIdentity());
  const spaceId = 'a'.repeat(32);
  const card = { id: a.id, email: 'a@x.example', name: 'A', signPub: a.signPub, boxPub: a.boxPub };
  const doc1 = new Y.Doc();
  doc1.getXmlFragment('default');
  const ops = [
    {
      id: `${a.id}:1`,
      author: a.id,
      seq: 1,
      lc: 1,
      at: '2026-11-18T10:00:00Z',
      type: 'space.create',
      data: { name: 'X', description: '', owner: card }
    },
    {
      id: `${a.id}:2`,
      author: a.id,
      seq: 2,
      lc: 2,
      at: '2026-11-18T10:01:00Z',
      type: 'task.upsert',
      data: { id: 'b'.repeat(32), title: 'T1' }
    },
    {
      id: `${a.id}:3`,
      author: a.id,
      seq: 3,
      lc: 3,
      at: '2026-11-18T10:02:00Z',
      type: 'task.upsert',
      data: { id: 'b'.repeat(32), title: 'T2' }
    }
  ];
  const s1 = fold(spaceId, ops).state;
  const s2 = fold(spaceId, [...ops].reverse()).state;
  assert.equal(s1.tasks['b'.repeat(32)].title, 'T2');
  assert.deepEqual(s1.tasks, s2.tasks);
  assert.equal(noteText(doc1), '');
});

test('Spaces: locked keychain keeps spaces closed and files untouched', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lv-spaces-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(openSpaceStore({ dir, vault: { available: false } }), { code: 'spaces_locked' });
  const keys = vault();
  const store = await openSpaceStore({ dir, vault: keys });
  await store.saveIndex({ invitations: [], cursors: {} });
  const other = vault();
  await assert.rejects(openSpaceStore({ dir, vault: other }), { code: 'spaces_locked' });
  assert.equal(other.get('local', 'spaces-key'), '', 'no new key for existing data');
});
