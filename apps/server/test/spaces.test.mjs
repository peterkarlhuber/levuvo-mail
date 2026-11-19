import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import {
  createIdentity,
  identityKeys,
  newSymmetricKey,
  open,
  seal,
  signed,
  signatureValid,
  wrapKey
} from '../src/spaces/crypto.mjs';
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
});

// QA-LEV-003 (audit 2026-11-19): join requests are really checked by the owner.
test('Spaces: join requests with an unknown, used or expired token or another address add nobody', async t => {
  const { office, anna, ben, cara, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Projekt', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  const annaCard = anna.service.detail(space.id).members.find(m => m.me);
  const owner = { id: annaCard.id, boxPub: anna.store.get(space.id) && identityKeys(anna.store.identity).boxPub };
  const joinFrom = (who, keysOf, token, email = who.email) => {
    const card = { id: keysOf.id, email, name: who.name, signPub: keysOf.signPub, boxPub: keysOf.boxPub };
    const k = newSymmetricKey();
    return signed(keysOf, {
      v: 1,
      t: 'boxed',
      space: space.id,
      from: keysOf.id,
      to: owner.id,
      wrap: wrapKey(k, owner.boxPub, space.id),
      box: seal(k, JSON.stringify({ t: 'join', token, card }), `boxed.${space.id}.${owner.id}`),
      card
    });
  };
  const members = () => anna.service.detail(space.id).members.filter(m => !m.removed).length;
  const caraKeys = identityKeys(cara.store.identity);
  // Unknown token.
  await anna.service.receiveEnvelope(anna.accountId, joinFrom(cara, caraKeys, 'a'.repeat(32)));
  // Ben's token was used already.
  const usedToken = Object.keys(anna.store.get(space.id).invites).find(k => anna.store.get(space.id).invites[k].used);
  await anna.service.receiveEnvelope(anna.accountId, joinFrom(cara, caraKeys, usedToken, ben.email));
  // A real invitation for Cara, but answered with another address, and by someone else's key.
  await anna.service.invite(space.id, { email: cara.email });
  const token = Object.entries(anna.store.get(space.id).invites).find(([, i]) => i.email === cara.email)[0];
  await anna.service.receiveEnvelope(anna.accountId, joinFrom(cara, caraKeys, token, 'other@posteo.example'));
  const mallory = identityKeys(createIdentity());
  const stolen = joinFrom(cara, caraKeys, token);
  const replayed = signed(mallory, { ...stolen, from: mallory.id, card: { ...stolen.card, id: mallory.id } });
  await anna.service.receiveEnvelope(anna.accountId, replayed);
  assert.equal(members(), 2);
  // Expired.
  anna.store.get(space.id).invites[token].expires = new Date(Date.now() - 1000).toISOString();
  await anna.service.receiveEnvelope(anna.accountId, joinFrom(cara, caraKeys, token));
  assert.equal(members(), 2);
  // And the valid one works.
  anna.store.get(space.id).invites[token].expires = new Date(Date.now() + 86400_000).toISOString();
  await anna.service.receiveEnvelope(anna.accountId, joinFrom(cara, caraKeys, token));
  assert.equal(members(), 3);
});

// QA-LEV-003: the permission check that matters is the one every receiver does while folding.
test('Spaces: correctly signed ops from readers, removed members or editors doing owner things are ignored', () => {
  const owner = identityKeys(createIdentity());
  const editor = identityKeys(createIdentity());
  const reader = identityKeys(createIdentity());
  const spaceId = 'c'.repeat(32);
  const card = (k, email) => ({ id: k.id, email, name: '', signPub: k.signPub, boxPub: k.boxPub });
  let lc = 0;
  const seqs = new Map();
  const op = (k, type, data) => {
    const seq = (seqs.get(k.id) || 0) + 1;
    seqs.set(k.id, seq);
    return signed(k, {
      v: 1,
      space: spaceId,
      author: k.id,
      seq,
      lc: ++lc,
      at: new Date(Date.UTC(2026, 10, 19, 0, lc)).toISOString(),
      type,
      data,
      id: `${k.id}:${seq}`
    });
  };
  const task = 'd'.repeat(32);
  const ops = [
    op(owner, 'space.create', { name: 'X', description: '', owner: card(owner, 'o@x.example') }),
    op(owner, 'member.add', { member: card(editor, 'e@x.example'), role: 'editor' }),
    op(owner, 'member.add', { member: card(reader, 'r@x.example'), role: 'reader' }),
    op(owner, 'task.upsert', { id: task, title: 'Original' }),
    // A reader writes, an editor does what only the owner may.
    op(reader, 'task.upsert', { id: task, title: 'Vom Leser' }),
    op(editor, 'member.role', { member: reader.id, role: 'editor' }),
    op(editor, 'ai.settings', { cloudAllowed: true }),
    op(editor, 'space.dissolve', {})
  ];
  const before = fold(spaceId, ops).state;
  assert.equal(before.tasks[task].title, 'Original');
  assert.equal(before.members[reader.id].role, 'reader');
  assert.equal(before.ai.cloudAllowed, false);
  assert.equal(before.dissolved, false);
  assert.equal(before.ignored, 4);
  // After removal (cut off at what the owner had), the editor's later ops are ignored too.
  const removed = [
    ...ops,
    op(owner, 'member.remove', { member: editor.id, upTo: 3 }),
    op(editor, 'task.upsert', { id: task, title: 'Nach dem Entfernen' })
  ];
  const after = fold(spaceId, removed).state;
  assert.equal(after.tasks[task].title, 'Original');
  assert.ok(after.members[editor.id].removed);
});

test('Spaces: files are chunked, encrypted and versioned', async t => {
  const { office, anna, ben, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Dateien', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  const big = Buffer.alloc(11 * 1024 * 1024, 1);
  const marker = 'GEHEIMER-GRUNDRISS-PLAN-0815';
  big.write(marker, 0);
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
  // (A short word could appear by chance in random base64; a long marker cannot.)
  const raw = readFileSync(join(anna.dir, 'blobs', chunk), 'utf8');
  assert.ok(!raw.includes(marker));
  assert.ok(!Buffer.from(JSON.parse(raw).data, 'base64url').includes(marker));
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
      v: 1,
      id: `${a.id}:1`,
      author: a.id,
      seq: 1,
      lc: 1,
      at: '2026-11-18T10:00:00Z',
      type: 'space.create',
      data: { name: 'X', description: '', owner: card }
    },
    {
      v: 1,
      id: `${a.id}:2`,
      author: a.id,
      seq: 2,
      lc: 2,
      at: '2026-11-18T10:01:00Z',
      type: 'task.upsert',
      data: { id: 'b'.repeat(32), title: 'T1' }
    },
    {
      v: 1,
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

test('Spaces: changes queued while mails are being sent are not lost', async t => {
  const { office, anna, ben, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Gleichzeitig', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  const first = anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Eins' });
  // A second change while the first flush is still running.
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Zwei' });
  await first;
  await office.deliver(all);
  assert.deepEqual(
    ben.service
      .detail(space.id)
      .tasks.map(x => x.title)
      .sort(),
    ['Eins', 'Zwei']
  );
});

test('Spaces: note text keeps formatted words and never yields markup', () => {
  const doc = new Y.Doc();
  const para = new Y.XmlElement('paragraph');
  const text = new Y.XmlText();
  text.insert(0, 'fett', { bold: true });
  text.insert(4, ' und <script>x</script>');
  para.insert(0, [text]);
  doc.getXmlFragment('default').insert(0, [para]);
  assert.equal(noteText(doc), 'fett und <script>x</script>');
});
