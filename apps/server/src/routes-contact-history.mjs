// Contact history ("mini CRM") and video call links. Account-free routes.
// History: notes about a person (contact-notes.mjs) and the tasks linked to them. The mails and
// appointments come from the existing local sources (encrypted search index, calendars), read by
// the UI; nothing is looked up online and nothing new is stored about mails.
// Video calls: only the link is built here (video-call.mjs); no connection to the server.
import { contactAddress } from './contact-notes.mjs';
import { DEFAULT_VIDEO_SERVER, newMeetingLink, normalizeVideoServer, VIDEO_PROVIDER } from './video-call.mjs';

/** Address in a From header like `Name <a@b.example>` (lower case), or ''. */
export function addressOf(from) {
  const s = String(from || '');
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/) || s.match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].toLowerCase() : '';
}

/** Tasks about a person: made in their contact history, or made from one of their mails. */
export function tasksForContact(tasks, email) {
  return tasks.filter(t => t.contact?.email === email || (t.mail && addressOf(t.mail.from) === email));
}

export function registerContactHistoryRoutes(ctx) {
  const { api, requireAction, settings } = ctx;
  const errorResponse = (reply, err) => ctx.errorResponse(reply, err, { domain: 'contact' });
  const notes = () => ctx.contactNotes;

  api.get('/api/contact-history', async (request, reply) => {
    try {
      const email = contactAddress(request.query?.email);
      let noteList = [];
      let notesError = null;
      try {
        noteList = notes().list(email);
      } catch (err) {
        if (err.statusCode !== 423) throw err;
        notesError = { code: err.code, error: err.message };
      }
      let taskList = [];
      let tasksError = null;
      try {
        taskList = tasksForContact(ctx.tasks.list({ view: 'all' }), email).map(({ sync, ...t }) => ({
          ...t,
          list: sync?.link || null
        }));
      } catch (err) {
        tasksError = { code: err.code, error: err.message };
      }
      return { email, notes: noteList, notesError, tasks: taskList, tasksError };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  const post = (path, handler) =>
    api.post(path, { bodyLimit: 32 * 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, 'contacts-v1')) return;
      try {
        return await handler(request.body || {});
      } catch (err) {
        return errorResponse(reply, err);
      }
    });
  post('/api/contact-history/notes/save', async b => ({
    note: await notes().save({ id: typeof b.id === 'string' ? b.id : null, email: b.email, text: b.text })
  }));
  post('/api/contact-history/notes/delete', async b => {
    await notes().remove(String(b.id || ''));
    return { ok: true };
  });
  post('/api/contact-history/forget', async b => ({ deleted: await notes().forget(b.email) }));

  // ------------------------------------------------------------------ video calls
  const videoState = () => {
    const custom = normalizeVideoServerSafe(settings.get().videoServer);
    return {
      provider: VIDEO_PROVIDER,
      server: custom || DEFAULT_VIDEO_SERVER,
      custom,
      defaultServer: DEFAULT_VIDEO_SERVER
    };
  };
  api.get('/api/video', async () => videoState());
  api.post('/api/video/settings', { bodyLimit: 2048 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    try {
      const server = normalizeVideoServer(request.body?.server);
      await settings.save({ ...settings.get(), videoServer: server });
      return videoState();
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.post('/api/video/link', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    return newMeetingLink(settings.get());
  });
}

function normalizeVideoServerSafe(value) {
  try {
    return normalizeVideoServer(value);
  } catch {
    return '';
  }
}
