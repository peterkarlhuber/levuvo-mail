import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpaceStore } from '../src/spaces/store.mjs';
import { createSpaceService } from '../src/spaces/service.mjs';
import { createTaskStore } from '../src/tasks.mjs';
import { createSpaceTaskLink, parseSpaceTaskId } from '../src/space-tasks.mjs';

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

/** A person's local task list (in memory) linked with their spaces, as routes-tasks.mjs does. */
function tasksOf(p, state = { tasks: [] }) {
  const file = { get: () => state, save: async next => void (state = next) };
  const tasks = createTaskStore(file);
  return { file, tasks, link: createSpaceTaskLink({ tasks, spaces: async () => p.service }) };
}

test('Space tasks: tasks assigned to me show in the main list and changes go both ways', async t => {
  const { office, anna, ben, cara, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Umbau Büro', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await joinSpace(office, anna, cara, space.id, 'reader', all);
  const benId = ben.service.identity.id;
  const taskId = anna.service.newId();
  await anna.service.apply(space.id, 'task.upsert', {
    id: taskId,
    title: 'Angebot Elektriker',
    due: '2026-11-25',
    priority: 'high',
    assignee: benId
  });
  await anna.service.apply(space.id, 'task.upsert', { id: anna.service.newId(), title: 'Nicht für Ben' });
  await office.deliver(all);

  const b = tasksOf(ben);
  await b.tasks.save({ title: 'Eigene Aufgabe' });
  const list = await b.link.list({ view: 'all' });
  assert.deepEqual(list.map(x => x.title).sort(), ['Angebot Elektriker', 'Eigene Aufgabe']);
  const shared = list.find(x => x.space);
  assert.equal(shared.space.name, 'Umbau Büro');
  assert.equal(shared.space.readOnly, false);
  assert.equal(shared.priority, 'high');
  assert.equal(shared.due, '2026-11-25');
  assert.deepEqual(parseSpaceTaskId(shared.id), { spaceId: space.id, taskId });
  // Nothing is copied into the local file: no duplicates, nothing for the sync engine.
  assert.equal(b.file.get().tasks.length, 1);
  assert.ok(!JSON.stringify(b.file.get()).includes('Elektriker'));
  // Not assigned to Anna: her main list stays empty.
  assert.equal((await tasksOf(anna).link.list()).length, 0);

  // Ben finishes it in the main area → done in the space for everyone.
  const done = await b.link.setDone(shared.id, true);
  assert.equal(done.task.done, true);
  await office.deliver(all);
  assert.equal(anna.service.detail(space.id).tasks.find(x => x.id === taskId).status, 'done');
  assert.equal((await b.link.list({ view: 'open' })).filter(x => x.space).length, 0);

  // Anna reopens and renames it in the space → Ben's main list follows.
  await anna.service.apply(space.id, 'task.upsert', { id: taskId, status: 'open', title: 'Angebot Elektriker (neu)' });
  await office.deliver(all);
  const again = (await b.link.list({ view: 'open' })).find(x => x.space);
  assert.equal(again.title, 'Angebot Elektriker (neu)');
  assert.equal(again.done, false);

  // Ben edits it in the main area: the space task changes, "in progress" is kept.
  await anna.service.apply(space.id, 'task.upsert', { id: taskId, status: 'doing' });
  await office.deliver(all);
  const saved = await b.link.save({ ...again, title: 'Angebot Elektriker bestätigt', priority: 'medium' });
  assert.equal(saved.title, 'Angebot Elektriker bestätigt');
  await office.deliver(all);
  const inSpace = anna.service.detail(space.id).tasks.find(x => x.id === taskId);
  assert.equal(inSpace.title, 'Angebot Elektriker bestätigt');
  assert.equal(inSpace.status, 'doing');
  assert.equal(inSpace.priority, 'normal');
  // A space task stays in its space.
  await assert.rejects(() => b.link.save({ ...saved, space: 'f'.repeat(32) }), { code: 'task_space_fixed' });

  // Reassigned to Cara: it leaves Ben's main list and shows read-only for Cara (reader).
  await anna.service.apply(space.id, 'task.upsert', { id: taskId, assignee: cara.service.identity.id });
  await office.deliver(all);
  assert.equal((await b.link.list()).filter(x => x.space).length, 0);
  await assert.rejects(() => b.link.setDone(saved.id, true), { code: 'task_missing' });
  const c = tasksOf(cara);
  const forCara = (await c.link.list()).find(x => x.space);
  assert.equal(forCara.space.readOnly, true);
  await assert.rejects(() => c.link.setDone(forCara.id, true), { code: 'spaces_forbidden' });
  await assert.rejects(() => c.link.remove(forCara.id), { code: 'spaces_forbidden' });
  // Readers cannot put tasks into the space.
  assert.deepEqual(await c.link.targets(), []);
  await assert.rejects(() => c.link.save({ title: 'x', space: space.id }), { code: 'spaces_forbidden' });
});

test('Space tasks: a task from the main area moves into a space and leaves connected lists', async t => {
  const { office, anna, ben, cara, all } = await threePeople(t);
  const space = await anna.service.create({ name: 'Projekt Nord', accountId: anna.accountId });
  await joinSpace(office, anna, ben, space.id, 'editor', all);
  await joinSpace(office, anna, cara, space.id, 'reader', all);
  // Ben's local task is in a connected list (e.g. Google Tasks) with a remote copy.
  const b = tasksOf(ben, {
    tasks: [],
    taskSync: { links: [{ id: 'link-g', provider: 'google', name: 'Meine Aufgaben' }], tombstones: [] }
  });
  const local = await b.tasks.save({ title: 'Statik prüfen', due: '2026-12-01', priority: 'low', list: 'link-g' });
  const state = b.file.get();
  state.tasks = state.tasks.map(x => (x.id === local.id ? { ...x, sync: { ...x.sync, remoteId: 'r-1' } } : x));

  assert.deepEqual(await b.link.targets(), [{ id: space.id, name: 'Projekt Nord' }]);
  const moved = await b.link.save({ ...local, space: space.id, remindAt: '2026-11-30T08:00:00.000Z' });
  assert.equal(moved.space.id, space.id);
  assert.equal(moved.remindAt, null);
  // Gone from the device and from the connected list (the remote copy is deleted on the next sync).
  assert.equal(b.tasks.get(local.id), null);
  assert.deepEqual(
    b.file.get().taskSync.tombstones.map(x => x.remoteId),
    ['r-1']
  );
  assert.equal((await b.link.list()).length, 1, 'no duplicate');

  // Every member sees it in the space, assigned to Ben.
  await office.deliver(all);
  for (const p of [anna, cara]) {
    const task = p.service.detail(space.id).tasks.find(x => x.title === 'Statik prüfen');
    assert.equal(task.assignee, ben.service.identity.id);
    assert.equal(task.due, '2026-12-01');
    assert.equal(task.priority, 'low');
  }

  // A new task straight into the space.
  const fresh = await b.link.save({ title: 'Baustelle fotografieren', space: space.id });
  assert.ok(fresh.space);
  assert.equal(b.file.get().tasks.length, 0);
  // Deleting it in the main area deletes it in the space (editor).
  await b.link.remove(fresh.id);
  await office.deliver(all);
  assert.ok(!anna.service.detail(space.id).tasks.some(x => x.title === 'Baustelle fotografieren'));
});

test('Space tasks: without spaces the main list works as before', async () => {
  const state = { tasks: [] };
  const file = { get: () => state, save: async next => Object.assign(state, next) };
  const tasks = createTaskStore(file);
  const link = createSpaceTaskLink({
    tasks,
    spaces: async () => {
      throw new Error('locked');
    }
  });
  await link.save({ title: 'Lokal' });
  assert.equal((await link.list()).length, 1);
  assert.deepEqual(await link.targets(), []);
  await assert.rejects(() => link.save({ title: 'x', space: 'a'.repeat(32) }), { code: 'spaces_unavailable' });
});
