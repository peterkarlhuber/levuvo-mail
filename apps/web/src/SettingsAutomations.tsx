// Settings → Automations: rules Levuvo Mail runs on new inbox mail (move, mark, flag, create a
// task). A rule is written in the editor or described in words (local AI proposes it). Before it
// is switched on, the user reads it in plain words and can try it on the newest mail (dry run).
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, FlaskConical, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ApiError, getJson, postJson } from './api';
import { aiEnabled, aiErrorText, runAi } from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Section } from './Settings';
import { Button, Dialog, Field } from './ui';
import {
  describeRule,
  newRule,
  type AutoAction,
  type AutoCondition,
  type AutoLogEntry,
  type AutoRule
} from './automation-rules';
import type { AccountItem, Folder } from './types';

type DryRun = {
  checked: number;
  total: number;
  matches: { accountId: string; uid: number; subject: string; from: string; date: string; task: string | null }[];
};
type AiRule = Omit<AutoRule, 'accountId' | 'enabled' | 'stop'> & { unclear?: string };

export function AutomationSettings({ accounts }: { accounts: AccountItem[] }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [rules, setRules] = useState<AutoRule[] | null>(null);
  const [log, setLog] = useState<AutoLogEntry[]>([]);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<AutoRule | null>(null);
  const label = (id: string) => accounts.find(a => a.id === id)?.label;

  const load = () =>
    getJson<{ rules: AutoRule[]; log: AutoLogEntry[] }>('/api/automations')
      .then(r => {
        setRules(r.rules || []);
        setLog(r.log || []);
      })
      .catch(e => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(rule: AutoRule, enabled: boolean) {
    try {
      await postJson('/api/automations/enable', { id: rule.id, enabled }, 'mail-v1');
      toast({
        text: enabled
          ? t('„{name}“ ist eingeschaltet. Sie gilt für Mails, die ab jetzt ankommen.', { name: rule.name })
          : t('„{name}“ ist ausgeschaltet.', { name: rule.name }),
        kind: 'success'
      });
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
    void load();
  }
  async function remove(rule: AutoRule) {
    if (
      !(await confirm({
        title: t('Regel „{name}“ löschen?', { name: rule.name }),
        confirmLabel: t('Löschen'),
        danger: true
      }))
    )
      return;
    await postJson('/api/automations/delete', { id: rule.id }, 'mail-v1').catch(() => {});
    void load();
  }
  async function move(i: number, dir: -1 | 1) {
    if (!rules) return;
    const ids = rules.map(r => r.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    await postJson('/api/automations/reorder', { ids }, 'mail-v1').catch(() => {});
    void load();
  }

  return (
    <>
      <Section
        title={t('Automatisierungen')}
        description={t(
          'Regeln, die Levuvo Mail auf neue Mails im Posteingang anwendet: verschieben, als gelesen oder mit Stern markieren und Aufgaben anlegen. Sie laufen, solange Levuvo Mail geöffnet ist; was in der Zwischenzeit kam, wird beim nächsten Start nachgeholt. Regeln löschen, beantworten oder leiten nie etwas weiter. Für Regeln, die auch bei geschlossener App gelten, gibt es die Serverfilter unter „Filter & Abwesenheit“.'
        )}
      >
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        {!rules && !error && (
          <p className="muted">
            <LoaderCircle size={14} className="spin" /> {t('Lädt …')}
          </p>
        )}
        {rules && rules.length === 0 && <p className="muted">{t('Noch keine Automatisierung.')}</p>}
        <ul className="auto-list">
          {rules?.map((r, i) => (
            <li key={r.id} className={`auto-card ${r.enabled ? '' : 'off'}`}>
              <div className="auto-card-head">
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={e => void toggle(r, e.target.checked)}
                    aria-label={t('„{name}“ eingeschaltet', { name: r.name })}
                  />{' '}
                  <strong>{r.name}</strong>
                </label>
                {r.origin === 'ai' && (
                  <span className="ai-label" title={t('Von der KI vorgeschlagen und von dir geprüft.')}>
                    <Sparkles size={11} aria-hidden="true" /> {t('KI-Vorschlag')}
                  </span>
                )}
                <span className="auto-card-tools">
                  <button
                    className="icon-button"
                    aria-label={t('Nach oben')}
                    disabled={i === 0}
                    onClick={() => void move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('Nach unten')}
                    disabled={i === rules.length - 1}
                    onClick={() => void move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button className="icon-button" aria-label={t('Regel bearbeiten')} onClick={() => setEdit(r)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-button" aria-label={t('Regel löschen')} onClick={() => void remove(r)}>
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              <p className="auto-describe">{describeRule(r, t, r.accountId ? label(r.accountId) : undefined)}</p>
            </li>
          ))}
        </ul>
        <Button
          icon={<Plus size={14} />}
          disabled={!accounts.length || (rules?.length || 0) >= 50}
          onClick={() => setEdit(newRule(accounts[0]?.id || ''))}
        >
          {t('Neue Automatisierung')}
        </Button>
      </Section>
      <Section
        title={t('Protokoll')}
        description={t(
          'Was die Regeln in den letzten 30 Tagen getan haben. Gespeichert werden nur Betreff, Regel und Aktion, verschlüsselt auf diesem Gerät.'
        )}
      >
        {log.length === 0 ? (
          <p className="muted">{t('Noch nichts ausgeführt.')}</p>
        ) : (
          <>
            <ul className="auto-log">
              {log.slice(0, 50).map((e, i) => (
                <li key={`${e.at}-${i}`} className={e.ok ? '' : 'failed'}>
                  <time dateTime={e.at}>
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.at))}
                  </time>
                  <span>
                    <strong>{e.rule}</strong> · {e.subject}
                  </span>
                  <span>{e.ok ? t('erledigt') : t('Fehler: {error}', { error: e.error || '' })}</span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await postJson('/api/automations/log/clear', {}, 'mail-v1').catch(() => {});
                void load();
              }}
            >
              {t('Protokoll leeren')}
            </Button>
          </>
        )}
      </Section>
      {edit && (
        <RuleEditor
          initial={edit}
          accounts={accounts}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function RuleEditor({
  initial,
  accounts,
  onClose,
  onSaved
}: {
  initial: AutoRule;
  accounts: AccountItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang, locale } = useT();
  const { toast } = useUi();
  const [rule, setRule] = useState<AutoRule>(initial);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [words, setWords] = useState('');
  const [ai, setAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiModel, setAiModel] = useState('');
  const [unclear, setUnclear] = useState('');
  const [dry, setDry] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<AutoRule>) => {
    setRule(r => ({ ...r, ...patch }));
    setDry(null);
  };
  const accountId = rule.accountId;
  useEffect(() => {
    void aiEnabled('classify').then(setAi);
  }, []);
  useEffect(() => {
    if (!accountId) return setFolders([]);
    getJson<{ folders: Folder[] }>('/api/folders', accountId)
      .then(d => setFolders(d.folders.filter(f => f.selectable !== false)))
      .catch(() => setFolders([]));
  }, [accountId]);

  const setCondition = (k: number, patch: Partial<AutoCondition>) =>
    set({ conditions: rule.conditions.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  const setAction = (k: number, next: AutoAction) => set({ actions: rule.actions.map((a, j) => (j === k ? next : a)) });
  const used = new Set(rule.actions.map(a => a.type));
  const blankAction = (type: AutoAction['type']): AutoAction =>
    type === 'move' ? { type, folder: '' } : type === 'task' ? { type, title: '{subject}', dueDays: 7 } : { type };

  async function propose() {
    setAiBusy(true);
    setUnclear('');
    try {
      const r = await runAi<AiRule>('automation_rule', {
        account: accountId || undefined,
        input: { text: words, folders: folders.map(f => f.path) },
        lang
      });
      const x = r.result;
      setRule(cur => ({
        ...cur,
        name: x.name || cur.name,
        match: x.match === 'any' ? 'any' : 'all',
        conditions: x.conditions,
        actions: x.actions.map(a =>
          a.type === 'move'
            ? { type: 'move', folder: (a as { folder?: string }).folder || '' }
            : a.type === 'task'
              ? {
                  type: 'task',
                  title: (a as { title?: string }).title || '{subject}',
                  dueDays: (a as { dueDays?: number | null }).dueDays ?? null
                }
              : { type: a.type }
        ),
        origin: 'ai'
      }));
      setDry(null);
      setAiModel(r.model);
      setUnclear(x.unclear || '');
    } catch (e) {
      toast({ text: aiErrorText(e instanceof ApiError ? e.code : undefined, t), kind: 'error' });
    } finally {
      setAiBusy(false);
    }
  }
  async function tryIt() {
    setBusy(true);
    setError('');
    try {
      setDry(
        await postJson<DryRun>(
          '/api/automations/dry-run',
          { rule: { ...rule, name: rule.name || 'Probe' }, accounts: accounts.map(a => a.id), limit: 50 },
          'mail-v1'
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      await postJson('/api/automations/save', { rule: { ...rule, enabled } }, 'mail-v1');
      toast({
        text: enabled
          ? t('Gespeichert und eingeschaltet. Die Regel gilt für Mails, die ab jetzt ankommen.')
          : t('Gespeichert. Die Regel ist noch ausgeschaltet.'),
        kind: 'success'
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fieldLabels: Record<AutoCondition['field'], string> = {
    from: t('Absender'),
    to: t('Empfänger'),
    subject: t('Betreff'),
    text: t('Text'),
    any: t('überall'),
    attachment: t('Anhänge')
  };
  const opLabels = {
    contains: t('enthält'),
    not_contains: t('enthält nicht'),
    is: t('ist genau'),
    ends_with: t('endet auf')
  };
  const actionLabels: Record<AutoAction['type'], string> = {
    move: t('In Ordner verschieben'),
    markRead: t('Als gelesen markieren'),
    flag: t('Mit Stern markieren'),
    task: t('Aufgabe anlegen')
  };
  const ready =
    rule.name.trim() &&
    rule.conditions.every(c => c.field === 'attachment' || c.value.trim()) &&
    rule.actions.every(a => a.type !== 'move' || a.folder);

  return (
    <Dialog
      title={initial.id ? t('Automatisierung bearbeiten') : t('Neue Automatisierung')}
      onClose={onClose}
      size="lg"
      dismissible={false}
      className="auto-editor"
      footer={
        <>
          <Button onClick={onClose}>{t('Abbrechen')}</Button>
          <Button icon={<FlaskConical size={14} />} disabled={!ready || busy} onClick={() => void tryIt()}>
            {t('Probelauf')}
          </Button>
          <Button disabled={!ready || busy} onClick={() => void save(false)}>
            {t('Speichern (aus)')}
          </Button>
          <Button variant="primary" disabled={!ready || busy} busy={busy} onClick={() => void save(true)}>
            {t('Speichern und einschalten')}
          </Button>
        </>
      }
    >
      {ai && (
        <div className="auto-words">
          <Field
            label={t('In einfachen Worten beschreiben')}
            hint={t('Die lokale KI schlägt daraus eine Regel vor. Du prüfst sie unten, bevor sie läuft.')}
          >
            <textarea
              rows={2}
              maxLength={1000}
              value={words}
              placeholder={t(
                'z. B. „Rechnungen von muster.at in den Ordner Buchhaltung und eine Aufgabe zum Bezahlen in 14 Tagen“'
              )}
              onChange={e => setWords(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            icon={aiBusy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
            disabled={!words.trim() || aiBusy}
            onClick={() => void propose()}
          >
            {t('Regel vorschlagen')}
          </Button>
        </div>
      )}
      {rule.origin === 'ai' && aiModel && (
        <p className="auto-ai-note" role="status">
          <span className="ai-label">
            <Sparkles size={11} aria-hidden="true" /> {t('KI-Vorschlag')} · {aiModel}
          </span>{' '}
          {t('Bitte prüfen: Die KI kann sich irren. Die Regel läuft erst, wenn du sie einschaltest.')}
          {unclear && <> {t('Nicht umgesetzt: {what}', { what: unclear })}</>}
        </p>
      )}
      <div className="auto-grid">
        <Field label={t('Name')}>
          <input value={rule.name} maxLength={80} onChange={e => set({ name: e.target.value })} />
        </Field>
        <Field label={t('Konto')}>
          <select
            value={rule.accountId}
            onChange={e =>
              set({
                accountId: e.target.value,
                actions: rule.actions.map(a => (a.type === 'move' ? { ...a, folder: '' } : a))
              })
            }
          >
            <option value="">{t('Alle Konten')}</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset className="auto-block">
        <legend>
          {t('Wenn')}{' '}
          <select
            aria-label={t('Verknüpfung')}
            value={rule.match}
            onChange={e => set({ match: e.target.value as AutoRule['match'] })}
          >
            <option value="all">{t('alle Bedingungen')}</option>
            <option value="any">{t('eine der Bedingungen')}</option>
          </select>{' '}
          {t('zutreffen:')}
        </legend>
        {rule.conditions.map((c, k) => (
          <div className="rule-line" key={k}>
            <select
              aria-label={t('Feld')}
              value={c.field}
              onChange={e => {
                const field = e.target.value as AutoCondition['field'];
                setCondition(
                  k,
                  field === 'attachment'
                    ? { field, op: 'yes', value: '' }
                    : { field, op: c.op === 'yes' || c.op === 'no' ? 'contains' : c.op }
                );
              }}
            >
              {Object.entries(fieldLabels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {c.field === 'attachment' ? (
              <select
                aria-label={t('Vergleich')}
                value={c.op}
                onChange={e => setCondition(k, { op: e.target.value as AutoCondition['op'] })}
              >
                <option value="yes">{t('vorhanden')}</option>
                <option value="no">{t('keine')}</option>
              </select>
            ) : (
              <>
                <select
                  aria-label={t('Vergleich')}
                  value={c.op}
                  onChange={e => setCondition(k, { op: e.target.value as AutoCondition['op'] })}
                >
                  {Object.entries(opLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('Wert')}
                  value={c.value}
                  maxLength={200}
                  onChange={e => setCondition(k, { value: e.target.value })}
                />
              </>
            )}
            {rule.conditions.length > 1 && (
              <button
                className="icon-button"
                aria-label={t('Bedingung entfernen')}
                onClick={() => set({ conditions: rule.conditions.filter((_, j) => j !== k) })}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {rule.conditions.length < 10 && (
          <button
            className="text-button"
            onClick={() => set({ conditions: [...rule.conditions, { field: 'subject', op: 'contains', value: '' }] })}
          >
            + {t('Bedingung')}
          </button>
        )}
      </fieldset>
      <fieldset className="auto-block">
        <legend>{t('dann:')}</legend>
        {rule.actions.map((a, k) => (
          <div className="rule-line" key={k}>
            <select
              aria-label={t('Aktion')}
              value={a.type}
              onChange={e => setAction(k, blankAction(e.target.value as AutoAction['type']))}
            >
              {(Object.keys(actionLabels) as AutoAction['type'][])
                .filter(type => type === a.type || !used.has(type))
                .map(type => (
                  <option key={type} value={type}>
                    {actionLabels[type]}
                  </option>
                ))}
            </select>
            {a.type === 'move' && (
              <select
                aria-label={t('Zielordner')}
                value={a.folder}
                disabled={!rule.accountId}
                onChange={e => setAction(k, { type: 'move', folder: e.target.value })}
              >
                <option value="">{rule.accountId ? t('Ordner wählen …') : t('Erst ein Konto wählen')}</option>
                {folders.map(f => (
                  <option key={f.path} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            )}
            {a.type === 'task' && (
              <>
                <input
                  aria-label={t('Titel der Aufgabe')}
                  title={t('{subject} wird durch den Betreff ersetzt, {from} durch den Absender.')}
                  value={a.title}
                  maxLength={300}
                  onChange={e => setAction(k, { ...a, title: e.target.value })}
                />
                <select
                  aria-label={t('Fällig')}
                  value={a.dueDays === null ? '' : String(a.dueDays)}
                  onChange={e => setAction(k, { ...a, dueDays: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">{t('ohne Fälligkeit')}</option>
                  {[0, 1, 2, 3, 7, 14, 30].map(d => (
                    <option key={d} value={d}>
                      {d === 0 ? t('heute fällig') : t('fällig in {days} Tagen', { days: d })}
                    </option>
                  ))}
                </select>
              </>
            )}
            {rule.actions.length > 1 && (
              <button
                className="icon-button"
                aria-label={t('Aktion entfernen')}
                onClick={() => set({ actions: rule.actions.filter((_, j) => j !== k) })}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
        {rule.actions.length < 4 && (
          <button
            className="text-button"
            onClick={() => {
              const free = (['task', 'markRead', 'flag', 'move'] as AutoAction['type'][]).find(x => !used.has(x));
              if (free) set({ actions: [...rule.actions, blankAction(free)] });
            }}
          >
            + {t('Aktion')}
          </button>
        )}
        <label className="toggle small">
          <input type="checkbox" checked={rule.stop} onChange={e => set({ stop: e.target.checked })} />{' '}
          {t('Danach keine weiteren Regeln anwenden')}
        </label>
      </fieldset>
      <section className="auto-preview" aria-live="polite">
        <h3>{t('So läuft die Regel')}</h3>
        <p>{describeRule(rule, t, rule.accountId ? accounts.find(a => a.id === rule.accountId)?.label : undefined)}</p>
        {dry && (
          <div className="auto-dry">
            <p>
              <strong>
                {t('Probelauf: {count} von {checked} neuesten Mails würden behandelt.', {
                  count: dry.total,
                  checked: dry.checked
                })}
              </strong>{' '}
              {t('Es wurde nichts verändert.')}
            </p>
            {dry.matches.length > 0 && (
              <ul>
                {dry.matches.slice(0, 20).map(m => (
                  <li key={`${m.accountId}-${m.uid}`}>
                    <span>{m.subject}</span>
                    <small>
                      {m.from} ·{' '}
                      {m.date ? new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(m.date)) : ''}
                      {m.task && <> · {t('Aufgabe: {title}', { title: m.task })}</>}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </Dialog>
  );
}
