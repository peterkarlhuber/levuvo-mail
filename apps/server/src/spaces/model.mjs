// Shared space state as a deterministic fold over signed operations.
//
// Every change in a space is an operation signed by its author. All members eventually hold the
// same set of operations; sorting them by (Lamport clock, author, sequence) and folding them
// yields the same state everywhere, whatever order the mails arrived in. Rich text notes use
// Yjs updates, which merge in any order. Everything else is last-writer-wins per field.
import * as Y from 'yjs';

const bad = message => new Error(message);
export const ROLES = ['owner', 'editor', 'reader'];
const CONTENT = new Set([
  'note.create',
  'note.update',
  'note.edit',
  'note.delete',
  'mail.add',
  'mail.remove',
  'comment.add',
  'comment.edit',
  'comment.delete',
  'task.upsert',
  'task.delete',
  'event.upsert',
  'event.delete',
  'file.add',
  'file.version',
  'file.update',
  'file.delete',
  'folder.create',
  'folder.delete'
]);
const OWNER_ONLY = new Set([
  'space.update',
  'space.transfer',
  'space.dissolve',
  'member.add',
  'member.role',
  'member.remove',
  'ai.settings'
]);
export const OP_TYPES = new Set(['space.create', 'member.leave', ...CONTENT, ...OWNER_ONLY]);

export const TASK_STATUS = ['open', 'doing', 'done'];
export const TASK_PRIORITY = ['low', 'normal', 'high'];
const ID = /^[a-f0-9]{16,64}$/;
const MEMBER_ID = /^[a-f0-9]{32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,255}$/;

const str = (v, max, { required = false, multiline = false } = {}) => {
  if (v === undefined || v === null) {
    if (required) throw bad('missing');
    return undefined;
  }
  if (typeof v !== 'string' || v.length > max) throw bad('invalid string');
  const clean = multiline ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') : v.replace(/[\x00-\x1f\x7f]/g, ' ');
  if (required && !clean.trim()) throw bad('empty');
  return multiline ? clean : clean.trim();
};
const id = v => {
  if (typeof v !== 'string' || !ID.test(v)) throw bad('invalid id');
  return v;
};
const memberRef = v => {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !MEMBER_ID.test(v)) throw bad('invalid member');
  return v;
};
const oneOf = (v, list) => {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw bad('invalid value');
  return v;
};
const when = v => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !(DAY.test(v) || DATETIME.test(v)) || Number.isNaN(Date.parse(v)))
    throw bad('invalid date');
  return v;
};
const address = v => {
  if (!v || typeof v !== 'object') throw bad('invalid address');
  const addr = str(v.address, 320, { required: true }).toLowerCase();
  if (!EMAIL.test(addr)) throw bad('invalid address');
  return { name: str(v.name, 200) || '', address: addr };
};
const list = (v, max, fn) => {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > max) throw bad('invalid list');
  return v.map(fn);
};
const b64 = (v, max) => {
  if (typeof v !== 'string' || v.length > max || !/^[A-Za-z0-9+/_=-]*$/.test(v)) throw bad('invalid data');
  return v;
};
const clean = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** Public part of a member: what other members need to verify and reach them. */
export function validCard(card) {
  if (!card || typeof card !== 'object') throw bad('invalid member');
  const email = str(card.email, 320, { required: true }).toLowerCase();
  if (!EMAIL.test(email)) throw bad('invalid member email');
  return {
    id: memberRef(card.id),
    email,
    name: str(card.name, 200) || '',
    signPub: b64(card.signPub, 43),
    boxPub: b64(card.boxPub, 43)
  };
}

const target = v => {
  if (!v || typeof v !== 'object') throw bad('invalid target');
  return {
    kind: oneOf(v.kind, ['mail', 'task', 'event', 'file', 'note', 'space']),
    id: v.kind === 'space' ? '' : id(v.id)
  };
};

/** Validates and normalises the data of an operation. Throws on anything unexpected. */
export function validateOpData(type, data = {}) {
  if (!OP_TYPES.has(type)) throw bad('unknown operation');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('invalid data');
  switch (type) {
    case 'space.create':
      return {
        name: str(data.name, 120, { required: true }),
        description: str(data.description, 2000, { multiline: true }) || '',
        owner: validCard(data.owner)
      };
    case 'space.update':
      return clean({ name: str(data.name, 120), description: str(data.description, 2000, { multiline: true }) });
    case 'space.transfer':
      return { to: memberRef(data.to) };
    case 'space.dissolve':
      return {};
    case 'ai.settings':
      // Per-space assistant rules; only the owner sets them, never the assistant itself.
      return clean({
        enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
        cloudAllowed: typeof data.cloudAllowed === 'boolean' ? data.cloudAllowed : undefined,
        instructions: str(data.instructions, 4000, { multiline: true })
      });
    case 'member.add':
      return { member: validCard(data.member), role: oneOf(data.role, ['editor', 'reader']) };
    case 'member.role':
      return { member: memberRef(data.member), role: oneOf(data.role, ['editor', 'reader']) };
    case 'member.remove':
      return { member: memberRef(data.member), upTo: Number.isInteger(data.upTo) && data.upTo >= 0 ? data.upTo : 0 };
    case 'member.leave':
      return {};
    case 'note.create':
      return { id: id(data.id), title: str(data.title, 200) || '' };
    case 'note.update':
      return clean({
        id: id(data.id),
        title: str(data.title, 200),
        pinned: typeof data.pinned === 'boolean' ? data.pinned : undefined
      });
    case 'note.edit':
      return { id: id(data.id), update: b64(data.update, 2 * 1024 * 1024) };
    case 'note.delete':
    case 'mail.remove':
    case 'comment.delete':
    case 'task.delete':
    case 'event.delete':
    case 'file.delete':
      return { id: id(data.id) };
    case 'mail.add':
      return {
        id: id(data.id),
        thread: str(data.thread, 200) || '',
        messageId: str(data.messageId, 998) || '',
        subject: str(data.subject, 998) || '',
        from: data.from ? address(data.from) : null,
        to: list(data.to || [], 100, address),
        cc: list(data.cc || [], 100, address),
        date: when(data.date) || null,
        text: str(data.text, 500_000, { multiline: true }) || '',
        attachments: list(data.attachments || [], 50, a => ({
          name: str(a?.name, 255) || 'Anhang',
          size: Number.isInteger(a?.size) && a.size >= 0 ? a.size : 0,
          file: a?.file ? id(a.file) : null
        }))
      };
    case 'comment.add':
      return {
        id: id(data.id),
        target: target(data.target),
        text: str(data.text, 20_000, { required: true, multiline: true })
      };
    case 'comment.edit':
      return { id: id(data.id), text: str(data.text, 20_000, { required: true, multiline: true }) };
    case 'task.upsert':
      return clean({
        id: id(data.id),
        title: str(data.title, 500),
        notes: str(data.notes, 20_000, { multiline: true }),
        status: oneOf(data.status, TASK_STATUS),
        priority: oneOf(data.priority, TASK_PRIORITY),
        due: when(data.due),
        assignee: data.assignee === undefined ? undefined : memberRef(data.assignee),
        source: data.source === undefined ? undefined : data.source === null ? null : target(data.source)
      });
    case 'event.upsert':
      return clean({
        id: id(data.id),
        title: str(data.title, 500),
        start: when(data.start),
        end: when(data.end),
        allDay: typeof data.allDay === 'boolean' ? data.allDay : undefined,
        location: str(data.location, 500),
        notes: str(data.notes, 20_000, { multiline: true }),
        attendees: list(data.attendees, 200, memberRef)
      });
    case 'file.add':
    case 'file.version':
      return clean({
        id: id(data.id),
        name: type === 'file.add' ? str(data.name, 255, { required: true }) : undefined,
        folder: type === 'file.add' ? folderPath(data.folder) : undefined,
        version: blobRef(data.version)
      });
    case 'file.update':
      return clean({
        id: id(data.id),
        name: str(data.name, 255),
        folder: data.folder === undefined ? undefined : folderPath(data.folder)
      });
    case 'folder.create':
    case 'folder.delete':
      return { path: folderPath(data.path, true) };
    default:
      throw bad('unknown operation');
  }
}
function folderPath(v, required = false) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad('invalid folder');
    return '';
  }
  if (typeof v !== 'string' || v.length > 500) throw bad('invalid folder');
  const parts = v.split('/').map(p => p.trim());
  if (parts.some(p => !p || p === '.' || p === '..' || p.length > 120 || /[\x00-\x1f\x7f\\]/.test(p)))
    throw bad('invalid folder');
  return parts.join('/');
}
function blobRef(v) {
  if (!v || typeof v !== 'object') throw bad('invalid file version');
  return {
    blob: id(v.blob),
    key: b64(v.key, 64),
    size: Number.isInteger(v.size) && v.size >= 0 && v.size <= 2 ** 40 ? v.size : 0,
    sha256: /^[a-f0-9]{64}$/.test(v.sha256 || '')
      ? v.sha256
      : (() => {
          throw bad('invalid hash');
        })(),
    mime: str(v.mime, 200) || 'application/octet-stream',
    chunks: Number.isInteger(v.chunks) && v.chunks >= 1 && v.chunks <= 100_000 ? v.chunks : 1,
    storage: oneOf(v.storage ?? 'mail', ['mail', 'webdav'])
  };
}

/** Total order of operations, identical on every member's device. */
export const compareOps = (a, b) => a.lc - b.lc || (a.author < b.author ? -1 : a.author > b.author ? 1 : a.seq - b.seq);

/** Plain text of a note's Yjs document (for search, the assistant and previews). */
export function noteText(doc) {
  const fragment = doc.getXmlFragment('default');
  const lines = [];
  const walk = (node, prefix = '') => {
    // The plain inserts of the text, without formatting marks (never parsed as markup).
    if (node instanceof Y.XmlText)
      return node
        .toDelta()
        .map(part => (typeof part.insert === 'string' ? part.insert : ''))
        .join('');
    if (node instanceof Y.XmlElement) {
      const inner = node
        .toArray()
        .map(child => walk(child, prefix))
        .join('');
      const name = node.nodeName;
      if (name === 'taskItem') {
        lines.push(`${node.getAttribute('checked') ? '[x]' : '[ ]'} ${inner.trim()}`);
        return '';
      }
      if (name === 'listItem') {
        lines.push(`- ${inner.trim()}`);
        return '';
      }
      if (['paragraph', 'heading', 'codeBlock', 'blockquote'].includes(name)) {
        if (inner.trim()) lines.push(inner);
        return '';
      }
      return inner;
    }
    return '';
  };
  for (const node of fragment.toArray()) walk(node);
  return lines.join('\n');
}

/** Yjs update that appends plain-text paragraphs (or checklist lines) to a note. */
export function appendTextUpdate(doc, text, { checklist = false } = {}) {
  const before = Y.encodeStateVector(doc);
  const fragment = doc.getXmlFragment('default');
  doc.transact(() => {
    const lines = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    if (checklist) {
      const listNode = new Y.XmlElement('taskList');
      const items = lines
        .filter(l => l.trim())
        .map(line => {
          const item = new Y.XmlElement('taskItem');
          const checked = /^\s*\[x\]/i.test(line);
          item.setAttribute('checked', checked);
          const para = new Y.XmlElement('paragraph');
          para.insert(0, [new Y.XmlText(line.replace(/^\s*\[[ x]\]\s*/i, ''))]);
          item.insert(0, [para]);
          return item;
        });
      listNode.insert(0, items);
      fragment.insert(fragment.length, [listNode]);
    } else {
      const paras = lines.map(line => {
        const para = new Y.XmlElement('paragraph');
        if (line) para.insert(0, [new Y.XmlText(line)]);
        return para;
      });
      fragment.insert(fragment.length, paras);
    }
  });
  return Y.encodeStateAsUpdate(doc, before);
}

export function emptyState(spaceId) {
  return {
    id: spaceId,
    name: '',
    description: '',
    owner: null,
    dissolved: false,
    ai: { enabled: true, cloudAllowed: false, instructions: '' },
    members: {},
    notes: {},
    mails: {},
    comments: {},
    tasks: {},
    events: {},
    files: {},
    folders: {},
    activity: [],
    ignored: 0
  };
}

const can = (state, author, type, data) => {
  const member = state.members[author];
  if (type === 'space.create') return !state.owner && data.owner && author === data.owner.id;
  if (!member || member.removed) return false;
  if (state.dissolved) return false;
  if (OWNER_ONLY.has(type)) return member.role === 'owner';
  if (type === 'member.leave') return member.role !== 'owner';
  if (CONTENT.has(type)) return member.role === 'owner' || member.role === 'editor';
  return false;
};

const summarize = (state, op) => {
  const d = op.data;
  const titleOf = (coll, key) => state[coll][key]?.title || state[coll][key]?.name || state[coll][key]?.subject || '';
  switch (op.type) {
    case 'note.edit':
      return { target: { kind: 'note', id: d.id }, label: titleOf('notes', d.id) };
    case 'comment.add':
      return { target: d.target, label: d.text.slice(0, 120) };
    case 'task.upsert':
    case 'task.delete':
      return { target: { kind: 'task', id: d.id }, label: titleOf('tasks', d.id), detail: d.status || '' };
    case 'event.upsert':
    case 'event.delete':
      return { target: { kind: 'event', id: d.id }, label: titleOf('events', d.id) };
    case 'file.add':
    case 'file.version':
    case 'file.update':
    case 'file.delete':
      return { target: { kind: 'file', id: d.id }, label: titleOf('files', d.id) };
    case 'mail.add':
    case 'mail.remove':
      return { target: { kind: 'mail', id: d.id }, label: titleOf('mails', d.id) };
    case 'note.create':
    case 'note.update':
    case 'note.delete':
      return { target: { kind: 'note', id: d.id }, label: titleOf('notes', d.id) };
    case 'member.add':
      return { target: { kind: 'space', id: '' }, label: d.member.name || d.member.email };
    case 'member.role':
    case 'member.remove':
      return {
        target: { kind: 'space', id: '' },
        label: state.members[d.member]?.name || state.members[d.member]?.email || '',
        detail: d.role || ''
      };
    case 'folder.create':
    case 'folder.delete':
      return { target: { kind: 'space', id: '' }, label: d.path };
    default:
      return { target: { kind: 'space', id: '' }, label: d.name || '' };
  }
};

/** Applies one verified operation. Returns false when the author was not allowed to do it. */
export function applyOp(state, op, docs) {
  const { author, type } = op;
  const d = op.data;
  if (!can(state, author, type, d)) {
    state.ignored++;
    return false;
  }
  const meta = { at: op.at, by: author };
  const member = state.members[author];
  // Ops a removed member wrote after the owner cut them off are ignored (see member.remove).
  if (member?.cutoff !== undefined && op.seq > member.cutoff) {
    state.ignored++;
    return false;
  }
  switch (type) {
    case 'space.create':
      state.name = d.name;
      state.description = d.description;
      state.owner = author;
      state.createdAt = op.at;
      state.members[author] = { ...d.owner, id: author, role: 'owner', joinedAt: op.at };
      break;
    case 'space.update':
      Object.assign(state, clean({ name: d.name, description: d.description }));
      break;
    case 'space.transfer': {
      const next = state.members[d.to];
      if (!next || next.removed) return (state.ignored++, false);
      state.members[author].role = 'editor';
      next.role = 'owner';
      state.owner = d.to;
      break;
    }
    case 'space.dissolve':
      state.dissolved = true;
      break;
    case 'ai.settings':
      state.ai = { ...state.ai, ...d };
      break;
    case 'member.add': {
      const card = d.member;
      if (state.members[card.id] && !state.members[card.id].removed) {
        state.members[card.id].role = d.role;
        break;
      }
      state.members[card.id] = { ...card, role: d.role, joinedAt: op.at, addedBy: author };
      break;
    }
    case 'member.role': {
      const m = state.members[d.member];
      if (!m || m.removed || m.role === 'owner') return (state.ignored++, false);
      m.role = d.role;
      break;
    }
    case 'member.remove': {
      const m = state.members[d.member];
      if (!m || m.removed || m.role === 'owner') return (state.ignored++, false);
      m.removed = op.at;
      m.cutoff = d.upTo;
      break;
    }
    case 'member.leave':
      member.removed = op.at;
      member.left = true;
      break;
    case 'note.create':
      if (state.notes[d.id]) return (state.ignored++, false);
      state.notes[d.id] = {
        id: d.id,
        title: d.title,
        createdAt: op.at,
        createdBy: author,
        updatedAt: op.at,
        updatedBy: author,
        pinned: false,
        deleted: false
      };
      docs.set(d.id, new Y.Doc());
      break;
    case 'note.update': {
      const n = state.notes[d.id];
      if (!n || n.deleted) return (state.ignored++, false);
      Object.assign(n, clean({ title: d.title, pinned: d.pinned }), { updatedAt: op.at, updatedBy: author });
      break;
    }
    case 'note.edit': {
      const n = state.notes[d.id];
      if (!n || n.deleted) return (state.ignored++, false);
      let doc = docs.get(d.id);
      if (!doc) docs.set(d.id, (doc = new Y.Doc()));
      try {
        Y.applyUpdate(doc, Buffer.from(d.update, 'base64'));
      } catch {
        return (state.ignored++, false);
      }
      n.updatedAt = op.at;
      n.updatedBy = author;
      break;
    }
    case 'note.delete':
      if (!state.notes[d.id]) return (state.ignored++, false);
      state.notes[d.id].deleted = true;
      break;
    case 'mail.add':
      if (state.mails[d.id]) return (state.ignored++, false);
      state.mails[d.id] = { ...d, addedAt: op.at, addedBy: author };
      break;
    case 'mail.remove':
      if (!state.mails[d.id]) return (state.ignored++, false);
      delete state.mails[d.id];
      break;
    case 'comment.add':
      if (state.comments[d.id]) return (state.ignored++, false);
      state.comments[d.id] = { id: d.id, target: d.target, text: d.text, at: op.at, by: author };
      break;
    case 'comment.edit':
    case 'comment.delete': {
      const c = state.comments[d.id];
      // Only the author edits a comment; the owner may also remove it.
      if (!c || (c.by !== author && !(type === 'comment.delete' && member.role === 'owner')))
        return (state.ignored++, false);
      if (type === 'comment.edit') Object.assign(c, { text: d.text, editedAt: op.at });
      else delete state.comments[d.id];
      break;
    }
    case 'task.upsert': {
      const prev = state.tasks[d.id];
      if (prev?.deleted) return (state.ignored++, false);
      if (!prev && !d.title) return (state.ignored++, false);
      const fields = { ...d };
      delete fields.id;
      const next = prev || {
        id: d.id,
        status: 'open',
        priority: 'normal',
        due: null,
        assignee: null,
        notes: '',
        createdAt: op.at,
        createdBy: author
      };
      Object.assign(next, fields, { updatedAt: op.at, updatedBy: author });
      if (fields.status === 'done' && prev?.status !== 'done') next.doneAt = op.at;
      if (fields.status && fields.status !== 'done') delete next.doneAt;
      state.tasks[d.id] = next;
      break;
    }
    case 'event.upsert': {
      const prev = state.events[d.id];
      if (prev?.deleted) return (state.ignored++, false);
      if (!prev && (!d.title || !d.start)) return (state.ignored++, false);
      const fields = { ...d };
      delete fields.id;
      const next = prev || {
        id: d.id,
        allDay: false,
        end: null,
        location: '',
        notes: '',
        attendees: [],
        createdAt: op.at,
        createdBy: author
      };
      Object.assign(next, fields, { updatedAt: op.at, updatedBy: author });
      state.events[d.id] = next;
      break;
    }
    case 'task.delete':
    case 'event.delete': {
      const coll = type === 'task.delete' ? state.tasks : state.events;
      if (!coll[d.id]) return (state.ignored++, false);
      coll[d.id].deleted = true;
      break;
    }
    case 'file.add':
      if (state.files[d.id]) return (state.ignored++, false);
      state.files[d.id] = {
        id: d.id,
        name: d.name,
        folder: d.folder || '',
        versions: [{ ...d.version, at: op.at, by: author }],
        createdAt: op.at,
        createdBy: author,
        deleted: false
      };
      break;
    case 'file.version': {
      const f = state.files[d.id];
      if (!f || f.deleted) return (state.ignored++, false);
      f.versions.push({ ...d.version, at: op.at, by: author });
      break;
    }
    case 'file.update': {
      const f = state.files[d.id];
      if (!f || f.deleted) return (state.ignored++, false);
      Object.assign(f, clean({ name: d.name, folder: d.folder }));
      break;
    }
    case 'file.delete':
      if (!state.files[d.id]) return (state.ignored++, false);
      state.files[d.id].deleted = true;
      break;
    case 'folder.create':
      state.folders[d.path] = { path: d.path, at: op.at, by: author };
      break;
    case 'folder.delete':
      if (
        Object.values(state.files).some(f => !f.deleted && (f.folder === d.path || f.folder.startsWith(`${d.path}/`)))
      )
        return (state.ignored++, false);
      for (const key of Object.keys(state.folders))
        if (key === d.path || key.startsWith(`${d.path}/`)) delete state.folders[key];
      break;
    default:
      return (state.ignored++, false);
  }
  // Activity feed: what happened, by whom, when. No counts or per-person statistics.
  state.activity.push({ op: op.id, at: op.at, by: author, type, ...meta, ...summarize(state, op) });
  if (state.activity.length > 2000) state.activity.splice(0, state.activity.length - 2000);
  return true;
}

/** Folds sorted operations into a fresh state. */
export function fold(spaceId, ops) {
  const state = emptyState(spaceId);
  const docs = new Map();
  for (const op of [...ops].sort(compareOps)) applyOp(state, op, docs);
  return { state, docs };
}
