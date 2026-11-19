// Space tasks in the main "Aufgaben" area.
//
// 1. Tasks assigned to me in a space ("Für mich") appear in the main task list, marked with the
//    space. They are read live from the space (spaces/service.mjs → myTasks) and never copied
//    into tasks-local.json: no duplicates, and the task-sync engine (CalDAV, Microsoft To Do,
//    Google Tasks) never sees them, so space tasks cannot reach an external service.
//    Changes made in the main area (title, note, due, priority, done) are space operations:
//    they are signed, end-to-end encrypted and go to every member like a change in the space;
//    the space roles apply (a reader sees the task but cannot change it).
// 2. A task in the main area can be put into a space. It then becomes a space task assigned to
//    me (every member sees it) and leaves this device's list – and, if it was in a connected
//    list, that list too (the usual deletion of the remote copy). Reminder, repetition and the
//    link to a mail stay behind: a space task has none of them.
//
// Ids of space tasks in the main area: `space:<spaceId>:<taskId>`.
import { filterTasks, sortTasks, VIEWS } from './tasks.mjs';

const PREFIX = 'space:';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (message, code = 'task_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

export const spaceTaskId = (spaceId, taskId) => `${PREFIX}${spaceId}:${taskId}`;
export function parseSpaceTaskId(id) {
  const m = /^space:([a-f0-9]{16,64}):([a-f0-9]{16,64})$/.exec(String(id || ''));
  return m ? { spaceId: m[1], taskId: m[2] } : null;
}
export const isSpaceTaskId = id => String(id || '').startsWith(PREFIX);

// Priorities: the main area knows none/low/medium/high, a space low/normal/high.
const toSpacePriority = p => (p === 'low' || p === 'high' ? p : 'normal');
const fromSpacePriority = p => (p === 'low' || p === 'high' ? p : 'none');
/** A space due value (date, or date and time with or without zone) as the main area stores it. */
function fromSpaceDue(due) {
  if (!due) return null;
  if (DATE.test(due)) return due;
  const at = Date.parse(due);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** A space task as a main-area task (read-only fields the main area knows, plus `space`). */
export function toMainTask({ space, task }) {
  const readOnly = space.role !== 'owner' && space.role !== 'editor';
  return {
    id: spaceTaskId(space.id, task.id),
    title: task.title || '',
    notes: task.notes || '',
    due: fromSpaceDue(task.due),
    remindAt: null,
    remindedAt: null,
    priority: fromSpacePriority(task.priority),
    repeat: null,
    source: 'manual',
    done: task.status === 'done',
    doneAt: task.status === 'done' ? task.doneAt || task.updatedAt || null : null,
    mail: null,
    list: null,
    space: { id: space.id, name: space.name, readOnly },
    status: task.status || 'open',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || ''
  };
}

function validTitle(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw fail('Bitte einen Titel eingeben.');
  const title = value.trim();
  if (!title) throw fail('Bitte einen Titel eingeben.');
  if (title.length > 500) throw fail('Ungültiges Feld: Titel.');
  return title;
}
function validNotes(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 20_000 || value.includes('\0')) throw fail('Ungültiges Feld: Notiz.');
  return value;
}
function validDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw fail('Ungültige Fälligkeit.');
  if (DATE.test(value)) return value;
  const at = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(at)) throw fail('Ungültige Fälligkeit.');
  return new Date(at).toISOString();
}

/**
 * `spaces` is a function that resolves to the space service (or rejects when spaces are not
 * available, e.g. locked keychain); `tasks` is the local task store.
 */
export function createSpaceTaskLink({ spaces, tasks }) {
  const service = async () => {
    try {
      return await spaces();
    } catch {
      return null;
    }
  };
  async function mine() {
    const s = await service();
    if (!s?.myTasks) return [];
    try {
      return s.myTasks().map(toMainTask);
    } catch {
      return [];
    }
  }
  /** My task in a space, or a clear error (also when it is no longer assigned to me). */
  async function find(id) {
    const ref = parseSpaceTaskId(id);
    const s = await service();
    if (!ref || !s) throw fail('Die Aufgabe gibt es nicht mehr.', 'task_missing', 404);
    const hit = s.myTasks().find(x => x.space.id === ref.spaceId && x.task.id === ref.taskId);
    if (!hit) throw fail('Die Aufgabe gibt es nicht mehr.', 'task_missing', 404);
    return { s, ref, hit };
  }
  const reread = async (s, spaceId, taskId) => {
    const hit = s.myTasks().find(x => x.space.id === spaceId && x.task.id === taskId);
    // Assigned to someone else in the meantime: the main area just no longer lists it.
    return hit ? toMainTask(hit) : null;
  };

  return {
    /** Local tasks and my space tasks of a view, in one order. */
    async list({ view = 'all', timeZone } = {}) {
      const local = tasks.list({ view, timeZone });
      const shared = await mine();
      if (!shared.length) return local;
      const v = VIEWS.includes(view) ? view : 'all';
      return sortTasks([...local, ...filterTasks(shared, v, { timeZone })]);
    },
    /** Spaces a task can be put into (owner or editor). */
    async targets() {
      const s = await service();
      return s?.writableSpaces ? s.writableSpaces().map(({ id, name }) => ({ id, name })) : [];
    },
    /**
     * Save from the main area. A space task is changed in its space; a task with `space` set is
     * created in that space (a local one moves there).
     */
    async save(input) {
      if (!input || typeof input !== 'object') throw fail('Ungültige Aufgabe.');
      // `space` is a space id; a task read from the list carries { id, name } and may come back.
      const target = input.space && typeof input.space === 'object' ? input.space.id : input.space;
      if (isSpaceTaskId(input.id)) {
        const { s, ref, hit } = await find(input.id);
        if (target !== undefined && target !== ref.spaceId)
          throw fail('Eine Raum-Aufgabe bleibt in ihrem Raum.', 'task_space_fixed');
        const data = {
          id: ref.taskId,
          title: validTitle(input.title),
          notes: validNotes(input.notes),
          due: validDue(input.due),
          priority: toSpacePriority(input.priority)
        };
        // "in progress" stays as it is unless the task is marked done or open.
        const done = hit.task.status === 'done';
        if (typeof input.done === 'boolean' && input.done !== done) data.status = input.done ? 'done' : 'open';
        await s.apply(ref.spaceId, 'task.upsert', data);
        return reread(s, ref.spaceId, ref.taskId);
      }
      if (typeof target !== 'string' || !target) return tasks.save(input);
      const s = await service();
      if (!s) throw fail('Räume sind gerade nicht verfügbar.', 'spaces_unavailable', 503);
      if (!s.writableSpaces().some(x => x.id === target))
        throw fail('In diesem Raum darfst du keine Aufgaben anlegen.', 'spaces_forbidden', 403);
      const existing = typeof input.id === 'string' && input.id ? tasks.get(input.id) : null;
      if (input.id && !existing) throw fail('Die Aufgabe gibt es nicht mehr.', 'task_missing', 404);
      const taskId = s.newId();
      await s.apply(target, 'task.upsert', {
        id: taskId,
        title: validTitle(input.title),
        notes: validNotes(input.notes),
        due: validDue(input.due),
        priority: toSpacePriority(input.priority),
        status: input.done === true ? 'done' : 'open',
        assignee: s.identity.id
      });
      // Moved: the local copy goes (a synced one is deleted from its list on the next sync).
      if (existing) await tasks.remove(existing.id);
      return reread(s, target, taskId);
    },
    async setDone(id, done) {
      if (!isSpaceTaskId(id)) return tasks.setDone(id, done);
      const { s, ref } = await find(id);
      await s.apply(ref.spaceId, 'task.upsert', { id: ref.taskId, status: done ? 'done' : 'open' });
      return { task: await reread(s, ref.spaceId, ref.taskId), finished: null };
    },
    async remove(id) {
      if (!isSpaceTaskId(id)) return tasks.remove(id);
      const { s, ref } = await find(id);
      await s.apply(ref.spaceId, 'task.delete', { id: ref.taskId });
    }
  };
}
