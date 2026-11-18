// Routines ("skills") of the Levuvo Mail Assistant: built-in templates plus the user's own. A routine is an
// instruction for an agent run on Levuvo Mail's MCP server, with a permission level and the tools it may
// use. Built-in routines only read or prepare drafts and proposals; nothing goes out without approval.
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const READ_TOOLS = [
  'list_accounts',
  'list_folders',
  'list_messages',
  'search_messages',
  'search_by_meaning',
  'read_message',
  'list_events',
  'find_free_time',
  'list_calendars',
  'search_contacts',
  'list_tasks'
];

/** Built-in routines. `instruction` is for the model (English); name and hint are UI texts (German keys). */
export const BUILTIN_SKILLS = [
  {
    id: 'briefing',
    name: 'Tagesbriefing',
    hint: 'Was heute wichtig ist: neue Mails, Termine und offene Aufgaben.',
    level: 'read',
    tools: READ_TOOLS,
    instruction:
      "Prepare my daily briefing. Look at unread messages in the inbox from the last 24 hours, today's and tomorrow's events and, if available, tasks due today or overdue. Report: 1) what needs my answer or action today (who, what, by when, with account, folder and uid), 2) today's schedule, 3) anything that can wait. Be brief, at most 15 lines. Do not change anything."
  },
  {
    id: 'unanswered',
    name: 'Offene Antworten',
    hint: 'Mails der letzten 7 Tage, die eine Antwort von dir erwarten.',
    level: 'read',
    tools: READ_TOOLS,
    instruction:
      'Find messages from the last 7 days in the inbox that ask me a question or expect an answer from me and that I have probably not answered yet. List each with sender, subject, what is expected and account/folder/uid. At most 15. Do not change anything.'
  },
  {
    id: 'newsletters',
    name: 'Newsletter aufräumen',
    hint: 'Welche Newsletter du kaum liest und abbestellen könntest.',
    level: 'read',
    tools: READ_TOOLS,
    instruction:
      'Find newsletters and marketing senders in the inbox of the last 60 days. Group them by sender, count messages and how many are still unread, and suggest which ones I could unsubscribe from or archive. Do not unsubscribe, move or delete anything.'
  },
  {
    id: 'meeting_prep',
    name: 'Meeting vorbereiten',
    hint: 'Zum nächsten Termin: worum es geht und was zuletzt besprochen wurde.',
    level: 'read',
    tools: READ_TOOLS,
    instruction:
      'Take my next event today or tomorrow that has a title suggesting a meeting. Find recent messages related to it (participants, subject words) and prepare: purpose, what was agreed or asked so far, open points, and documents mentioned. Do not change anything.'
  },
  {
    id: 'schedule',
    name: 'Termin vereinbaren',
    hint: 'Findet freie Zeiten und bereitet eine Mail mit Vorschlägen als Entwurf vor.',
    level: 'draft',
    tools: [...READ_TOOLS, 'create_draft'],
    param: { name: 'with', label: 'Mit wem und worum?' },
    instruction:
      'Arrange a meeting: {with}. Look up the person in contacts or recent mail to get the address. Use find_free_time for the next 10 working days (60 minutes unless stated) and pick three good slots on different days. Then create a draft email to that person proposing the three slots, in the language of our previous messages. Do not send. Report the draft and the slots.'
  },
  {
    id: 'reply_drafts',
    name: 'Antwortentwürfe vorbereiten',
    hint: 'Entwirft Antworten auf offene Mails, du prüfst und sendest selbst.',
    level: 'draft',
    tools: [...READ_TOOLS, 'create_draft'],
    instruction:
      'Find up to 5 messages from the last 3 days in the inbox that clearly expect a short answer from me. For each, create a reply draft (in reply to the message, same language, my usual tone, placeholders like [date] where facts are missing). Do not send. Report which drafts you created.'
  }
];

const ID = /^[a-z0-9_-]{1,40}$/;

export async function createSkills({ createJsonFile, dir }) {
  const file = await createJsonFile(path.join(dir, 'ai-skills.json'), { skills: [] });
  const own = () => (Array.isArray(file.get().skills) ? file.get().skills : []);
  const clean = (v, n) =>
    String(v ?? '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .slice(0, n);
  return {
    list: () => [...BUILTIN_SKILLS.map(s => ({ ...s, builtin: true })), ...own().map(s => ({ ...s, builtin: false }))],
    get(id) {
      return BUILTIN_SKILLS.find(s => s.id === id) || own().find(s => s.id === id) || null;
    },
    async save(input) {
      const name = clean(input.name, 80).trim();
      const instruction = clean(input.instruction, 4000).trim();
      if (!name || !instruction) throw Object.assign(new Error('Name und Anweisung fehlen.'), { statusCode: 400 });
      const level = input.level === 'draft' ? 'draft' : 'read';
      const id =
        input.id && ID.test(input.id) && own().some(s => s.id === input.id)
          ? input.id
          : `own-${randomUUID().slice(0, 8)}`;
      const skill = {
        id,
        name,
        hint: clean(input.hint, 200),
        instruction,
        level,
        tools: level === 'draft' ? [...READ_TOOLS, 'create_draft', 'propose_event', 'propose_contact'] : READ_TOOLS
      };
      await file.save({ skills: [...own().filter(s => s.id !== id), skill].slice(-50) });
      return skill;
    },
    async remove(id) {
      await file.save({ skills: own().filter(s => s.id !== id) });
    },
    clear: () => file.save({ skills: [] })
  };
}

/** The final instruction of a routine, with its parameter filled in (the parameter is the user's own text). */
export function skillInstruction(skill, params = {}) {
  let text = skill.instruction;
  if (skill.param) {
    const value = String(params[skill.param.name] ?? '')
      .slice(0, 500)
      .trim();
    if (!value) throw Object.assign(new Error('Bitte die Angabe ergänzen.'), { statusCode: 400 });
    text = text.replace(`{${skill.param.name}}`, value);
  }
  return text;
}
