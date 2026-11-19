// Automations: storage, the API for the editor (save, dry run) and the runner on new inbox mail.
//
// automations.json, encrypted (key `automations-key`): the rules, the last inbox UID seen per
// account (so a rule only handles mail that arrives after it was switched on) and a short log of
// what the rules did (kept 30 days, at most 300 entries; subject only, never the content).
import { randomUUID } from 'node:crypto';
import { internalApi } from './internal-api.mjs';
import { MAX_RULES, plan, taskFor, validateRule } from './automations.mjs';

const LOG_DAYS = 30;
const LOG_MAX = 300;
const DRY_RUN_MAX = 100;
const fail = (message, code = 'automation_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

export const EMPTY_AUTOMATIONS = { rules: [], cursors: {}, log: [] };

/**
 * `api`: messages(account, opts), messageAction(account, uid, body), folders(account);
 * `tasks`: the task store (save). `timeZone()` for due dates.
 */
export function createAutomations({
  file,
  api,
  tasks,
  now = () => new Date(),
  timeZone = () => 'Europe/Vienna',
  logger = () => {}
}) {
  const state = () => ({ ...EMPTY_AUTOMATIONS, ...file.get() });
  const save = patch => file.save({ ...state(), ...patch });
  let queue = Promise.resolve();
  const serial = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function folderCheck(accountId) {
    if (!accountId) return () => true;
    try {
      const r = await api.folders(accountId);
      const paths = new Set((r.folders || []).map(f => f.path));
      return (_a, path) => paths.has(path);
    } catch {
      return () => true; // offline: checked again when the rule runs
    }
  }

  async function saveRule(input = {}) {
    const s = state();
    const existing = input.id ? s.rules.find(r => r.id === input.id) : null;
    if (input.id && !existing) throw fail('Regel nicht gefunden.', 'automation_missing', 404);
    if (!existing && s.rules.length >= MAX_RULES) throw fail(`Höchstens ${MAX_RULES} Regeln.`);
    const clean = validateRule(input, { folderExists: await folderCheck(input.accountId) });
    if (clean.actions.some(a => a.type === 'move') && !clean.accountId)
      throw fail('Zum Verschieben bitte ein Konto wählen: Ordner gibt es nur pro Konto.');
    const stamp = now().toISOString();
    const rule = {
      id: existing?.id || randomUUID(),
      ...clean,
      origin: existing?.origin || clean.origin,
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
      // When it was switched on: shown in the list, and the runner never touches older mail.
      enabledAt: clean.enabled ? (existing?.enabled ? existing.enabledAt : stamp) : null
    };
    const rules = existing ? s.rules.map(r => (r.id === rule.id ? rule : r)) : [...s.rules, rule];
    await save({ rules });
    return rule;
  }
  async function setEnabled(id, enabled) {
    const rule = state().rules.find(r => r.id === id);
    if (!rule) throw fail('Regel nicht gefunden.', 'automation_missing', 404);
    // Switching off always works (also when a folder vanished); switching on checks the rule again.
    if (enabled === true) return saveRule({ ...rule, enabled: true });
    const off = { ...rule, enabled: false, enabledAt: null, updatedAt: now().toISOString() };
    await save({ rules: state().rules.map(r => (r.id === id ? off : r)) });
    return off;
  }
  async function remove(id) {
    await save({ rules: state().rules.filter(r => r.id !== id) });
    return { ok: true };
  }
  async function reorder(ids) {
    const s = state();
    if (!Array.isArray(ids)) throw fail('Ungültige Reihenfolge.');
    const byId = new Map(s.rules.map(r => [r.id, r]));
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    await save({ rules: [...ordered, ...s.rules.filter(r => !ids.includes(r.id))] });
    return { rules: state().rules };
  }

  /** Dry run: which of the newest inbox messages a rule would handle, and how. Changes nothing. */
  async function dryRun(input = {}) {
    const rule = validateRule(
      { ...input.rule, name: input.rule?.name || 'Probe' },
      { folderExists: await folderCheck(input.rule?.accountId) }
    );
    const accounts = rule.accountId
      ? [rule.accountId]
      : (Array.isArray(input.accounts) ? input.accounts : []).slice(0, 10).map(String);
    if (!accounts.length) throw fail('Bitte ein Konto wählen.');
    const limit = Number.isInteger(input.limit) ? Math.min(DRY_RUN_MAX, Math.max(10, input.limit)) : 50;
    const matches = [];
    let checked = 0;
    for (const accountId of accounts) {
      const r = await api.messages(accountId, { folder: 'INBOX', limit });
      for (const m of r.messages || []) {
        checked++;
        if (plan([{ ...rule, enabled: true, stop: false }], m, { accountId }).length)
          matches.push({
            accountId,
            uid: m.uid,
            subject: m.subject,
            from: m.fromName || m.fromEmail,
            date: m.date,
            task: rule.actions.find(a => a.type === 'task')
              ? taskFor(
                  rule.actions.find(a => a.type === 'task'),
                  m,
                  { accountId, now: now(), timeZone: timeZone() }
                ).title
              : null
          });
      }
    }
    return { checked, matches: matches.slice(0, 50), total: matches.length, actions: rule.actions };
  }

  // ---------------------------------------------------------------- runner
  async function addLog(entries) {
    if (!entries.length) return;
    const cutoff = now().getTime() - LOG_DAYS * 86_400_000;
    const log = [...state().log.filter(e => Date.parse(e.at) >= cutoff), ...entries].slice(-LOG_MAX);
    await save({ log });
  }
  async function execute(accountId, m, actions) {
    const done = [];
    for (const a of actions) {
      if (a.type === 'task') {
        if (!tasks?.available) throw fail('Aufgaben sind gerade nicht verfügbar.', 'automation_tasks');
        await tasks.save(taskFor(a, m, { accountId, now: now(), timeZone: timeZone() }));
      } else if (a.type === 'markRead') {
        await api.messageAction(accountId, m.uid, { folder: 'INBOX', action: 'markRead' });
      } else if (a.type === 'flag') {
        await api.messageAction(accountId, m.uid, { folder: 'INBOX', action: 'flag' });
      } else if (a.type === 'move') {
        // notToTrash: a rule can never move mail into the trash.
        await api.messageAction(accountId, m.uid, {
          folder: 'INBOX',
          action: 'move',
          destination: a.folder,
          notToTrash: true
        });
      }
      done.push(a.type);
    }
    return done;
  }

  /**
   * New inbox mail of an account (newest messages of the IDLE snapshot). Only messages above the
   * last UID seen are handled; the first snapshot of an account (or a new UIDVALIDITY) only sets
   * that mark, so existing mail is never touched.
   */
  function onSnapshot(accountId, snapshot) {
    return serial(async () => {
      if (!snapshot || !Array.isArray(snapshot.messages)) return [];
      const s = state();
      const cursor = s.cursors[accountId];
      const validity = String(snapshot.uidValidity || '');
      const highest = Math.max(Number(snapshot.highestUid) || 0, ...snapshot.messages.map(m => m.uid || 0));
      const setCursor = uid => save({ cursors: { ...state().cursors, [accountId]: { uidValidity: validity, uid } } });
      if (!cursor || cursor.uidValidity !== validity) {
        await setCursor(highest);
        return [];
      }
      if (highest <= cursor.uid) return [];
      const fresh = snapshot.messages.filter(m => m.uid > cursor.uid).sort((a, b) => a.uid - b.uid);
      const rules = s.rules.filter(r => r.enabled && (!r.accountId || r.accountId === accountId));
      const entries = [];
      for (const m of rules.length ? fresh : []) {
        for (const { rule, actions } of plan(rules, m, { accountId })) {
          const entry = {
            at: now().toISOString(),
            ruleId: rule.id,
            rule: rule.name,
            accountId,
            subject: String(m.subject || '').slice(0, 120),
            actions: actions.map(a => a.type)
          };
          try {
            entry.done = await execute(accountId, m, actions);
            entry.ok = true;
          } catch (err) {
            entry.ok = false;
            entry.error = String(err.message || err.code || 'Fehler').slice(0, 200);
            logger(`automation ${rule.id} failed: ${err.code || err.message}`);
          }
          entries.push(entry);
        }
      }
      await setCursor(highest);
      await addLog(entries);
      return entries;
    });
  }

  return {
    list: () => ({ rules: state().rules, log: [...state().log].reverse() }),
    saveRule,
    setEnabled,
    remove,
    reorder,
    dryRun,
    onSnapshot,
    async clearLog() {
      await save({ log: [] });
      return { ok: true };
    },
    forgetAccount: accountId =>
      serial(async () => {
        const s = state();
        const cursors = { ...s.cursors };
        delete cursors[accountId];
        await save({ cursors, rules: s.rules.filter(r => r.accountId !== accountId) });
      })
  };
}

export function registerAutomationRoutes(ctx, { file }) {
  const { api, requireAction, errorResponse } = ctx;
  const internal = internalApi(ctx);
  const service = createAutomations({
    file,
    api: {
      messages: internal.messages,
      messageAction: internal.messageAction,
      folders: internal.folders
    },
    tasks: ctx.tasks,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna',
    logger: ctx.logger
  });
  ctx.automations = service;
  ctx.onAccountChange?.(id => {
    if (!ctx.accounts().some(a => a.id === id)) void service.forgetAccount(id).catch(() => {});
  });

  const guard = (route, handler) =>
    api.post(route, { bodyLimit: 64 * 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, 'mail-v1')) return;
      try {
        return await handler(request.body || {});
      } catch (err) {
        return errorResponse(reply, err, { domain: 'automation' });
      }
    });
  api.get('/api/automations', async () => service.list());
  guard('/api/automations/save', b => service.saveRule(b.rule || {}));
  guard('/api/automations/enable', b => service.setEnabled(String(b.id || ''), b.enabled === true));
  guard('/api/automations/delete', b => service.remove(String(b.id || '')));
  guard('/api/automations/reorder', b => service.reorder(b.ids));
  guard('/api/automations/dry-run', b => service.dryRun(b));
  guard('/api/automations/log/clear', () => service.clearLog());

  ctx.watchers?.subscribe?.((accountId, snapshot) => {
    void service.onSnapshot(accountId, snapshot).catch(() => {});
  });
  return service;
}
