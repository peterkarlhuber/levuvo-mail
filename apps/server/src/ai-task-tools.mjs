// Task tools for the Levuvo Mail Assistant and external agents (MCP), on top of the task list
// (ctx.tasks). Registered through the shared tool registry, so levels, rate limit, log and
// approvals are the same as for the built-in tools.
//
// read      list_tasks       open, today, overdue … (tasks linked to a hidden account are left out)
// draft     propose_task     waits for the user's approval
// organize  create_task      creates it directly (source "ai"), complete_task marks done/open
// Deleting tasks is not available as a tool.

const VIEWS = ['today', 'upcoming', 'overdue', 'open', 'done', 'all'];
const PRIORITIES = ['none', 'low', 'medium', 'high'];
const DUE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const toolError = message => Object.assign(new Error(message), { toolError: true });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

function store(ctx) {
  const tasks = ctx.tasks;
  if (!tasks?.save || !tasks.list) throw toolError('The task list is not available in this version.');
  if (tasks.available === false) throw toolError('The task list is locked (keychain not available).');
  return tasks;
}

/** The fields an agent may set; everything else (mail link, repeat, reminders) stays with the user. */
export function taskInput(a) {
  const title = String(a?.title ?? '').trim();
  if (!title || title.length > 300) throw toolError('A title of 1 to 300 characters is required.');
  const notes = String(a?.notes ?? '').slice(0, 4000);
  const due = a?.due == null || a.due === '' ? null : String(a.due);
  if (due && !DUE.test(due)) throw toolError('due must be YYYY-MM-DD or an ISO date-time.');
  const priority = a?.priority == null ? 'none' : String(a.priority);
  if (!PRIORITIES.includes(priority)) throw toolError(`priority must be one of ${PRIORITIES.join(', ')}.`);
  return { title, notes, due, priority, source: 'ai' };
}

const view = t => ({
  id: t.id,
  title: t.title,
  notes: t.notes || '',
  due: t.due || null,
  priority: t.priority || 'none',
  done: Boolean(t.done),
  mail: t.mail ? { account: t.mail.accountId, folder: t.mail.folder, uid: t.mail.uid, subject: t.mail.subject } : null
});

export function registerTaskTools(ctx, { registry, frame }) {
  registry.registerApproval('task', {
    // Structured fields only: the app builds the localised title (approvalTitle, case 'task').
    summary: p => ({ title: p.title, due: p.due, priority: p.priority, notes: p.notes }),
    execute: async p => {
      const task = await store(ctx).save(taskInput(p));
      return { id: task.id };
    }
  });
  const fields = {
    title: { type: 'string', description: 'Short task title (at most 300 characters).' },
    notes: { type: 'string', description: 'Optional details.' },
    due: { type: 'string', description: 'Optional due date YYYY-MM-DD, or an ISO date-time.' },
    priority: { type: 'string', enum: PRIORITIES }
  };
  registry.register([
    {
      name: 'list_tasks',
      level: 'read',
      readOnly: true,
      description:
        "Lists the user's tasks. view: today (due today), overdue, upcoming, open (not done), done or all. Tasks created from a mail name that mail (account, folder, uid).",
      inputSchema: obj({
        view: { type: 'string', enum: VIEWS, description: 'Default: open.' },
        timeZone: { type: 'string', description: 'IANA time zone for "today", e.g. Europe/Vienna.' }
      }),
      async run(a, agent) {
        const v = VIEWS.includes(a.view) ? a.view : 'open';
        const hidden = new Set(agent?.hiddenAccounts || []);
        const list = store(ctx)
          .list({ view: v, timeZone: typeof a.timeZone === 'string' ? a.timeZone.slice(0, 64) : undefined })
          .filter(t => !(t.mail && hidden.has(t.mail.accountId)))
          .slice(0, 200)
          .map(view);
        // Titles can come from mail subjects: third-party text.
        return frame(JSON.stringify(list, null, 1), `levuvo:tasks ${v}`);
      }
    },
    {
      name: 'propose_task',
      level: 'draft',
      approval: 'task',
      description:
        'Proposes a new task. Nothing is saved until the user approves it in Levuvo Mail. Use create_task only if you have the organize level and the user asked for it.',
      inputSchema: obj(fields, ['title']),
      run: async a => taskInput(a)
    },
    {
      name: 'create_task',
      level: 'organize',
      description: 'Creates a task in the local task list right away (marked as created by the assistant).',
      inputSchema: obj(fields, ['title']),
      async run(a) {
        const task = await store(ctx).save(taskInput(a));
        return JSON.stringify({ created: task.id, title: task.title, due: task.due || null });
      }
    },
    {
      name: 'complete_task',
      level: 'organize',
      description:
        'Marks a task as done (or, with done=false, as open again). Repeating tasks move to their next date.',
      inputSchema: obj({ id: { type: 'string' }, done: { type: 'boolean', description: 'Default: true.' } }, ['id']),
      async run(a, agent) {
        const tasks = store(ctx);
        const id = String(a.id || '').slice(0, 100);
        const task = tasks.get?.(id);
        if (!task) throw toolError('Unknown task. Use list_tasks.');
        if (task.mail && (agent?.hiddenAccounts || []).includes(task.mail.accountId))
          throw toolError('Unknown task. Use list_tasks.');
        const r = await tasks.setDone(id, a.done !== false);
        return JSON.stringify({ id, done: Boolean(r?.task?.done), next: r?.finished ? r.task.due || null : null });
      }
    }
  ]);
}
