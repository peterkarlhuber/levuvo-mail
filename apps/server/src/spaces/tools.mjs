// Space tools for the Levuvo Mail Assistant and external agents (MCP).
//
// The assistant can do in a space what the user can do by clicking: read, summarise, search,
// create notes, tasks, events and comments, pin mails. Every change is visible to other members,
// so each one waits for the user's approval. Inviting, removing members and changing roles need
// the highest agent level and an approval too. Dissolving a space, deleting it locally, keys and
// the space's assistant settings are not available as tools at all.
// Content written by other members is framed as untrusted data (prompt-injection protection).

const LIMIT_TEXT = 12_000;
const ID = /^[a-f0-9]{16,64}$/;
const bad = message => new Error(message);
const toolError = message => Object.assign(new Error(message), { toolError: true });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ROOM = { type: 'string', description: 'Space ID (from list_rooms) or its exact name.' };
const short = (text, max = LIMIT_TEXT) => {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)} …[gekürzt]` : s;
};

/** Pure helpers (exported for tests). */
export function roomOverview(detail, { textLimit = 4000 } = {}) {
  const names = Object.fromEntries(detail.members.map(m => [m.id, m.name || m.email]));
  const who = id => names[id] || id;
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    myRole: detail.role,
    members: detail.members
      .filter(m => !m.removed)
      .map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role })),
    notes: detail.notes.map(n => ({
      id: n.id,
      title: n.title,
      updatedAt: n.updatedAt,
      updatedBy: who(n.updatedBy),
      text: short(n.text, textLimit)
    })),
    tasks: detail.tasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due: t.due,
      assignee: t.assignee ? who(t.assignee) : null,
      notes: short(t.notes, 1000)
    })),
    events: detail.events.map(e => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
      attendees: (e.attendees || []).map(who)
    })),
    mails: detail.mails.map(m => ({
      id: m.id,
      subject: m.subject,
      from: m.from?.address || '',
      date: m.date,
      attachments: m.attachments.map(a => a.name),
      text: short(m.text, 1500)
    })),
    comments: detail.comments.map(c => ({
      id: c.id,
      on: c.target,
      by: who(c.by),
      at: c.at,
      text: short(c.text, 1000)
    })),
    files: detail.files.map(f => ({
      id: f.id,
      name: f.name,
      folder: f.folder,
      versions: f.versions.length,
      size: f.versions.at(-1)?.size,
      updatedAt: f.versions.at(-1)?.at
    }))
  };
}

export function searchRoom(detail, query, { limit = 30 } = {}) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2);
  if (!words.length) return [];
  const hits = [];
  const consider = (kind, id, title, text) => {
    const hay = `${title}\n${text}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return;
    const pos = hay.indexOf(words[0]);
    const snippet = `${title}\n${text}`.slice(Math.max(0, pos - 120), pos + 240);
    hits.push({ source: { room: detail.id, kind, id }, title, snippet });
  };
  for (const n of detail.notes) consider('note', n.id, n.title, n.text);
  for (const t of detail.tasks) consider('task', t.id, t.title, t.notes || '');
  for (const e of detail.events) consider('event', e.id, e.title, `${e.location || ''} ${e.notes || ''}`);
  for (const m of detail.mails) consider('mail', m.id, m.subject, `${m.from?.address || ''}\n${m.text}`);
  for (const c of detail.comments) consider('comment', c.id, '', c.text);
  for (const f of detail.files) consider('file', f.id, f.name, f.folder);
  return hits.slice(0, limit);
}

const TEXTUAL = /^(text\/|application\/(json|xml|csv|x-ndjson|javascript|x-yaml))/i;

export function registerSpaceTools(ctx, { service, registry = null, frame = null }) {
  if (registry && frame) return register(registry, frame);
  // The MCP server comes from the assistant module; without it there is nothing to register.
  void import('../mcp-server.mjs')
    .then(mod => {
      if (typeof mod.mcpToolRegistry !== 'function') return;
      register(mod.mcpToolRegistry(ctx), mod.frameUntrusted);
    })
    .catch(() => {});

  function register(reg, frameUntrusted) {
    const untrusted = (value, label) =>
      frameUntrusted(JSON.stringify(value, null, 1), `levuvo:room ${label}`.slice(0, 120));
    /** Spaces the assistant may see: the user is an active member and the owner did not turn it off. */
    // Cloud models (and external agents) only see spaces whose owner allowed it; only the
    // built-in assistant with a local model has agent.cloud === false.
    async function rooms(agent) {
      const cloud = agent?.cloud !== false;
      const s = await service();
      return s
        .list()
        .spaces.filter(r => r.status === 'active' || r.status === 'joining')
        .map(r => ({ ...r, ai: r.status === 'active' ? s.detail(r.id).ai : { enabled: true } }))
        .filter(r => r.ai.enabled !== false && (!cloud || r.ai.cloudAllowed === true));
    }
    async function room(ref, agent) {
      const list = await rooms(agent);
      const value = String(ref || '').trim();
      const found = list.find(r => r.id === value) || list.find(r => r.name.toLowerCase() === value.toLowerCase());
      if (!found) throw toolError('Space not found or not available to the assistant. Use list_rooms.');
      if (found.status !== 'active') throw toolError('This space is still being joined; try again later.');
      const s = await service();
      return { s, detail: s.detail(found.id) };
    }
    const member = (detail, ref) => {
      if (!ref) return null;
      const v = String(ref).toLowerCase();
      const m = detail.members.find(
        x => !x.removed && (x.id === v || x.email === v || (x.name || '').toLowerCase() === v)
      );
      if (!m) throw toolError(`No active member "${String(ref).slice(0, 80)}" in this space.`);
      return m.id;
    };
    const writable = detail => {
      if (!['owner', 'editor'].includes(detail.role))
        throw toolError('The user can only read this space (role: reader).');
    };

    // ------------------------------------------------------------ approvals
    reg.registerApproval('room_change', {
      summary: p => ({
        title: `Raum „${p.roomName}“: ${p.label}`,
        room: p.roomName,
        action: p.action,
        details: p.preview
      }),
      execute: async p => {
        const s = await service();
        switch (p.action) {
          case 'create_room':
            return s.create({ name: p.data.name, description: p.data.description, accountId: p.data.accountId });
          case 'create_note':
            return { id: await s.createNote(p.room, p.data) };
          case 'append_note':
            await s.appendToNote(p.room, p.data.id, p.data.text, { checklist: p.data.checklist });
            return { ok: true };
          case 'op':
            await s.apply(p.room, p.data.type, p.data.data);
            return { ok: true, id: p.data.data.id };
          case 'add_mail':
            return ctx.spaces.addMail(p.room, p.data);
          case 'invite':
            return s.invite(p.room, p.data);
          case 'remove_member':
            await s.removeMember(p.room, p.data.member);
            return { ok: true };
          case 'set_role':
            await s.setRole(p.room, p.data.member, p.data.role);
            return { ok: true };
          default:
            throw bad('unknown room action');
        }
      }
    });
    const change = (detail, action, label, data, preview = {}) => ({
      room: detail?.id || null,
      roomName: detail?.name || data.name,
      action,
      label,
      data,
      preview
    });

    reg.register([
      // ---------------------------------------------------------- read
      {
        name: 'list_rooms',
        level: 'read',
        readOnly: true,
        description:
          'List the shared spaces ("Räume") the user is a member of: id, name, role, members, open tasks, last change.',
        inputSchema: obj({}),
        run: async (_a, agent) => {
          const list = await rooms(agent);
          return untrusted(
            list.map(r => ({
              id: r.id,
              name: r.name,
              description: r.description,
              role: r.role,
              status: r.status,
              members: r.members,
              openTasks: r.openTasks,
              updatedAt: r.updatedAt,
              cloudAllowed: r.ai.cloudAllowed === true
            })),
            'list'
          );
        }
      },
      {
        name: 'read_room',
        level: 'read',
        readOnly: true,
        description:
          'Everything in one space: members, notes (scratchpad), tasks, events, pinned mails, comments and files. Cite items by kind and id.',
        inputSchema: obj({ room: ROOM }, ['room']),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          return untrusted({ ...roomOverview(detail), instructions: detail.ai.instructions || '' }, detail.name);
        }
      },
      {
        name: 'room_changes',
        level: 'read',
        readOnly: true,
        description:
          'What changed in a space since a point in time (default: last 24 hours), with who did it. For "what happened since yesterday" summaries.',
        inputSchema: obj({ room: ROOM, since: { type: 'string', description: 'ISO date/time' } }, ['room']),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          const since =
            a.since && !Number.isNaN(Date.parse(a.since))
              ? new Date(a.since).toISOString()
              : new Date(Date.now() - 86400_000).toISOString();
          const names = Object.fromEntries(detail.members.map(m => [m.id, m.name || m.email]));
          const changes = detail.activity
            .filter(x => x.at >= since)
            .map(x => ({
              at: x.at,
              by: names[x.by] || x.by,
              type: x.type,
              item: x.target,
              label: x.label,
              detail: x.detail || ''
            }));
          return untrusted({ since, changes: changes.slice(0, 300) }, detail.name);
        }
      },
      {
        name: 'search_rooms',
        level: 'read',
        readOnly: true,
        description:
          'Search notes, tasks, events, pinned mails, comments and file names in one space or all spaces. Each hit has a source {room, kind, id} to cite.',
        inputSchema: obj({ query: { type: 'string', minLength: 2, maxLength: 200 }, room: ROOM }, ['query']),
        run: async (a, agent) => {
          const s = await service();
          const targets = a.room
            ? [(await room(a.room, agent)).detail]
            : (await rooms(agent)).filter(r => r.status === 'active').map(r => s.detail(r.id));
          const hits = targets.flatMap(d => searchRoom(d, a.query).map(h => ({ ...h, roomName: d.name })));
          return untrusted(hits.slice(0, 50), 'search');
        }
      },
      {
        name: 'read_room_file',
        level: 'read',
        readOnly: true,
        description:
          'Read a text file of a space (txt, md, csv, json, html …), optionally an older version, e.g. to summarise or compare versions.',
        inputSchema: obj({ room: ROOM, file: { type: 'string' }, version: { type: 'integer', minimum: 1 } }, [
          'room',
          'file'
        ]),
        run: async (a, agent) => {
          const { s, detail } = await room(a.room, agent);
          const file = detail.files.find(f => f.id === a.file || f.name === a.file);
          if (!file) throw toolError('File not found in this space.');
          const v = a.version ? file.versions[a.version - 1] : file.versions.at(-1);
          if (!v) throw toolError('Version not found.');
          if (!TEXTUAL.test(v.mime) && !/\.(txt|md|csv|json|xml|html?|ya?ml|log)$/i.test(file.name))
            return JSON.stringify({
              name: file.name,
              mime: v.mime,
              size: v.size,
              versions: file.versions.length,
              note: 'Not a text file; only its details are available.'
            });
          const got = await s.readFile(detail.id, file.id, a.version).catch(err => {
            throw toolError(
              err.code === 'spaces_file_pending'
                ? 'The file is still being fetched from another member; try again shortly.'
                : 'The file could not be read.'
            );
          });
          return untrusted(
            {
              name: file.name,
              version: a.version || file.versions.length,
              text: short(got.data.toString('utf8'), 60_000)
            },
            `${detail.name} file`
          );
        }
      },
      // ---------------------------------------------------------- changes (approval)
      {
        name: 'room_create',
        level: 'organize',
        approval: 'room_change',
        description: 'Create a new shared space owned by the user (approval required).',
        inputSchema: obj(
          {
            name: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 2000 },
            account: { type: 'string', description: 'Account ID to sync with (default: first account).' }
          },
          ['name']
        ),
        run: async a => {
          const account = a.account ? ctx.accounts().find(x => x.id === a.account) : ctx.accounts()[0];
          if (!account) throw toolError('No mail account set up.');
          return change(
            null,
            'create_room',
            `Neuen Raum „${String(a.name).slice(0, 120)}“ anlegen`,
            {
              name: String(a.name).slice(0, 120),
              description: String(a.description || '').slice(0, 2000),
              accountId: account.id
            },
            { account: account.imap?.user || '' }
          );
        }
      },
      {
        name: 'room_create_note',
        level: 'organize',
        approval: 'room_change',
        description:
          'Create a note in a space (meeting minutes, onboarding text, checklist). Lines starting with "[ ]" become a checklist when checklist=true.',
        inputSchema: obj(
          {
            room: ROOM,
            title: { type: 'string', maxLength: 200 },
            text: { type: 'string', maxLength: 50_000 },
            checklist: { type: 'boolean' }
          },
          ['room', 'title']
        ),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          writable(detail);
          return change(
            detail,
            'create_note',
            `Notiz „${String(a.title).slice(0, 80)}“ anlegen`,
            {
              title: String(a.title).slice(0, 200),
              text: String(a.text || '').slice(0, 50_000),
              checklist: a.checklist === true
            },
            { text: short(a.text, 2000) }
          );
        }
      },
      {
        name: 'room_append_note',
        level: 'organize',
        approval: 'room_change',
        description:
          'Append text (or checklist lines) to an existing note of a space. Merges with concurrent edits of others.',
        inputSchema: obj(
          {
            room: ROOM,
            note: { type: 'string' },
            text: { type: 'string', maxLength: 50_000 },
            checklist: { type: 'boolean' }
          },
          ['room', 'note', 'text']
        ),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          writable(detail);
          const note = detail.notes.find(n => n.id === a.note || n.title === a.note);
          if (!note) throw toolError('Note not found.');
          return change(
            detail,
            'append_note',
            `Notiz „${note.title || 'Ohne Titel'}“ ergänzen`,
            { id: note.id, text: String(a.text).slice(0, 50_000), checklist: a.checklist === true },
            { text: short(a.text, 2000) }
          );
        }
      },
      {
        name: 'room_add_task',
        level: 'organize',
        approval: 'room_change',
        description:
          'Add a task to a space, optionally assigned to a member (id, email or name) and with a due date (YYYY-MM-DD).',
        inputSchema: obj(
          {
            room: ROOM,
            title: { type: 'string', maxLength: 500 },
            notes: { type: 'string', maxLength: 20_000 },
            due: { type: 'string' },
            assignee: { type: 'string' },
            priority: { enum: ['low', 'normal', 'high'] }
          },
          ['room', 'title']
        ),
        run: async (a, agent) => {
          const { s, detail } = await room(a.room, agent);
          writable(detail);
          const data = {
            id: s.newId(),
            title: String(a.title).slice(0, 500),
            notes: a.notes,
            due: a.due || null,
            assignee: member(detail, a.assignee),
            priority: a.priority
          };
          return change(
            detail,
            'op',
            `Aufgabe „${data.title.slice(0, 80)}“ anlegen`,
            { type: 'task.upsert', data },
            { due: data.due, assignee: a.assignee || '' }
          );
        }
      },
      {
        name: 'room_update_task',
        level: 'organize',
        approval: 'room_change',
        description: 'Change a task of a space: status (open, doing, done), assignee, due date, title or priority.',
        inputSchema: obj(
          {
            room: ROOM,
            task: { type: 'string' },
            status: { enum: ['open', 'doing', 'done'] },
            assignee: { type: 'string' },
            due: { type: 'string' },
            title: { type: 'string', maxLength: 500 },
            priority: { enum: ['low', 'normal', 'high'] }
          },
          ['room', 'task']
        ),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          writable(detail);
          const task = detail.tasks.find(t => t.id === a.task || t.title === a.task);
          if (!task) throw toolError('Task not found.');
          const data = {
            id: task.id,
            status: a.status,
            title: a.title,
            due: a.due,
            priority: a.priority,
            ...(a.assignee !== undefined ? { assignee: a.assignee ? member(detail, a.assignee) : null } : {})
          };
          return change(
            detail,
            'op',
            `Aufgabe „${task.title.slice(0, 80)}“ ändern`,
            { type: 'task.upsert', data },
            { status: a.status || '', assignee: a.assignee || '', due: a.due || '' }
          );
        }
      },
      {
        name: 'room_add_event',
        level: 'organize',
        approval: 'room_change',
        description:
          'Add an event to a space calendar, with member attendees (ids, emails or names). Times as ISO 8601.',
        inputSchema: obj(
          {
            room: ROOM,
            title: { type: 'string', maxLength: 500 },
            start: { type: 'string' },
            end: { type: 'string' },
            allDay: { type: 'boolean' },
            location: { type: 'string', maxLength: 500 },
            notes: { type: 'string', maxLength: 20_000 },
            attendees: { type: 'array', items: { type: 'string' }, maxItems: 50 }
          },
          ['room', 'title', 'start']
        ),
        run: async (a, agent) => {
          const { s, detail } = await room(a.room, agent);
          writable(detail);
          const data = {
            id: s.newId(),
            title: String(a.title).slice(0, 500),
            start: a.start,
            end: a.end || null,
            allDay: a.allDay === true,
            location: a.location,
            notes: a.notes,
            attendees: (a.attendees || []).map(x => member(detail, x))
          };
          return change(
            detail,
            'op',
            `Termin „${data.title.slice(0, 80)}“ eintragen`,
            { type: 'event.upsert', data },
            { start: a.start, end: a.end || '' }
          );
        }
      },
      {
        name: 'room_comment',
        level: 'organize',
        approval: 'room_change',
        description:
          'Write an internal comment in a space, on a mail, task, event, file or note (target_kind + target_id), or on the space itself.',
        inputSchema: obj(
          {
            room: ROOM,
            text: { type: 'string', maxLength: 20_000 },
            target_kind: { enum: ['mail', 'task', 'event', 'file', 'note', 'space'] },
            target_id: { type: 'string' }
          },
          ['room', 'text']
        ),
        run: async (a, agent) => {
          const { s, detail } = await room(a.room, agent);
          writable(detail);
          const kind = a.target_kind || 'space';
          if (kind !== 'space' && !ID.test(String(a.target_id || '')))
            throw toolError('target_id is required for this target.');
          const data = {
            id: s.newId(),
            target: { kind, id: kind === 'space' ? '' : a.target_id },
            text: String(a.text).slice(0, 20_000)
          };
          return change(
            detail,
            'op',
            'Kommentar schreiben',
            { type: 'comment.add', data },
            { text: short(a.text, 1000) }
          );
        }
      },
      {
        name: 'room_add_mail',
        level: 'organize',
        approval: 'room_change',
        description:
          'Pin a mail (account, folder, uid from the mail tools) to a space so all members see it, optionally with its attachments as files.',
        inputSchema: obj(
          {
            room: ROOM,
            account: { type: 'string' },
            folder: { type: 'string' },
            uid: { type: 'integer' },
            with_attachments: { type: 'boolean' }
          },
          ['room', 'folder', 'uid']
        ),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          writable(detail);
          return change(
            detail,
            'add_mail',
            'Mail in den Raum legen',
            { account: a.account, folder: a.folder, uid: a.uid, withAttachments: a.with_attachments === true },
            { folder: a.folder, uid: a.uid }
          );
        }
      },
      {
        name: 'room_invite',
        level: 'full',
        approval: 'room_change',
        description:
          'Invite a person by email to a space the user owns (role editor or reader). Sends an invitation mail after approval.',
        inputSchema: obj(
          { room: ROOM, email: { type: 'string', maxLength: 320 }, role: { enum: ['editor', 'reader'] } },
          ['room', 'email']
        ),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          if (!detail.owner) throw toolError('Only the owner of the space can invite.');
          return change(
            detail,
            'invite',
            `${String(a.email).slice(0, 120)} einladen`,
            { email: String(a.email).slice(0, 320), role: a.role || 'editor' },
            { role: a.role || 'editor' }
          );
        }
      },
      {
        name: 'room_remove_member',
        level: 'full',
        approval: 'room_change',
        description: 'Remove a member from a space the user owns. The space key is replaced afterwards.',
        inputSchema: obj({ room: ROOM, member: { type: 'string' } }, ['room', 'member']),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          if (!detail.owner) throw toolError('Only the owner of the space can remove members.');
          const id = member(detail, a.member);
          const m = detail.members.find(x => x.id === id);
          return change(detail, 'remove_member', `${m.name || m.email} entfernen`, { member: id }, { email: m.email });
        }
      },
      {
        name: 'room_set_role',
        level: 'full',
        approval: 'room_change',
        description: 'Change the role of a member (editor or reader) in a space the user owns.',
        inputSchema: obj({ room: ROOM, member: { type: 'string' }, role: { enum: ['editor', 'reader'] } }, [
          'room',
          'member',
          'role'
        ]),
        run: async (a, agent) => {
          const { detail } = await room(a.room, agent);
          if (!detail.owner) throw toolError('Only the owner of the space can change roles.');
          const id = member(detail, a.member);
          const m = detail.members.find(x => x.id === id);
          return change(
            detail,
            'set_role',
            `Rolle von ${m.name || m.email} ändern`,
            { member: id, role: a.role },
            { role: a.role }
          );
        }
      }
    ]);
  }
}
