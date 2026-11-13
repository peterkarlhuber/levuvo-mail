import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { getJson, postJson, ApiError } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Section } from './Settings';
import type { AccountItem, Folder } from './types';

type Condition = { field: 'from' | 'to' | 'subject' | 'any'; op: 'contains' | 'is' | 'not_contains'; value: string };
type RuleAction = { type: 'move' | 'markRead' | 'flag' | 'trash'; folder?: string };
type Rule = {
  name: string;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: Condition[];
  actions: RuleAction[];
  stop: boolean;
};
type Vacation = {
  enabled: boolean;
  subject: string;
  body: string;
  days: number;
  start: string;
  end: string;
  addresses: string[];
};
type SieveState = {
  available: boolean;
  reason?: string;
  config: { rules: Rule[]; vacation: Vacation };
  foreignActive: string | null;
  capabilities: string[];
};

const newRule = (n: number): Rule => ({
  name: `Regel ${n}`,
  enabled: true,
  match: 'all',
  conditions: [{ field: 'from', op: 'contains', value: '' }],
  actions: [{ type: 'move', folder: '' }],
  stop: true
});

export function FiltersSettings({ accounts }: { accounts: AccountItem[] }) {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [state, setState] = useState<SieveState | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    setState(null);
    setError('');
    setDirty(false);
    getJson<SieveState>('/api/sieve', accountId)
      .then(setState)
      .catch(e => setError((e as Error).message));
    getJson<{ folders: Folder[] }>('/api/folders', accountId)
      .then(d => setFolders(d.folders))
      .catch(() => setFolders([]));
  }, [accountId]);

  const config = state?.config;
  const update = (patch: Partial<SieveState['config']>) => {
    if (!state) return;
    setState({ ...state, config: { ...state.config, ...patch } });
    setDirty(true);
  };
  const updateRule = (i: number, patch: Partial<Rule>) =>
    config && update({ rules: config.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const vacation = config?.vacation;
  const setVacation = (patch: Partial<Vacation>) => vacation && update({ vacation: { ...vacation, ...patch } });

  async function save(replaceForeign = false) {
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      await postJson('/api/sieve', { config: state.config, replaceForeign }, 'mail-v1', accountId);
      setDirty(false);
      setState({ ...state, foreignActive: null });
      toast({ text: t('Filter und Abwesenheitsnotiz sind auf dem Mailserver aktiv.'), kind: 'success' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sieve_foreign_active') {
        if (
          await confirm({
            title: t('Vorhandene Serverregeln ersetzen?'),
            message: t(
              'Auf dem Server ist bereits das Filterskript „{name}“ aktiv (z. B. aus dem Webmail). Levuvo Mail kann es deaktivieren und eigene Regeln aktivieren. Das alte Skript bleibt gespeichert.',
              { name: state.foreignActive || '?' }
            ),
            confirmLabel: t('Ersetzen'),
            danger: true
          })
        ) {
          setBusy(false);
          return save(true);
        }
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fieldLabels = { from: t('Von'), to: t('An/CC'), subject: t('Betreff'), any: t('Kopfzeilen') };
  const opLabels = { contains: t('enthält'), is: t('ist genau'), not_contains: t('enthält nicht') };
  const actionLabels = {
    move: t('In Ordner verschieben'),
    markRead: t('Als gelesen markieren'),
    flag: t('Markieren (Stern)'),
    trash: t('In den Papierkorb')
  };

  return (
    <>
      {accounts.length > 1 && (
        <label className="settings-inline">
          {t('Konto')}
          <select
            value={accountId}
            onChange={async e => {
              if (
                dirty &&
                !(await confirm({ title: t('Änderungen verwerfen?'), confirmLabel: t('Verwerfen'), danger: true }))
              )
                return;
              setAccountId(e.target.value);
            }}
          >
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.mailbox})
              </option>
            ))}
          </select>
        </label>
      )}
      {!state && !error && (
        <p className="muted">
          <LoaderCircle size={14} className="spin" /> {t('Verbinde mit dem Filterserver …')}
        </p>
      )}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {state && !state.available && (
        <Section
          title={t('Nicht verfügbar')}
          description={state.reason || t('Dein Mailserver bietet keine Serverfilter (ManageSieve) an.')}
        >
          <p className="settings-description">
            {t(
              'Tipp: Prüfe in den Kontoeinstellungen den Filterserver (Sieve-Host/Port) oder richte Regeln im Webmail deines Anbieters ein.'
            )}
          </p>
        </Section>
      )}
      {state?.available && config && vacation && (
        <>
          <Section
            title={t('Abwesenheitsnotiz')}
            description={t(
              'Wird vom Mailserver automatisch beantwortet – auch wenn Levuvo Mail geschlossen ist. Jeder Absender erhält die Notiz höchstens einmal im gewählten Abstand.'
            )}
          >
            <label className="toggle">
              <input
                type="checkbox"
                checked={vacation.enabled}
                onChange={e => setVacation({ enabled: e.target.checked })}
              />{' '}
              {t('Abwesenheitsnotiz aktiv')}
            </label>
            <div className="managed-field-grid">
              <label>
                {t('Von (optional)')}
                <input type="date" value={vacation.start} onChange={e => setVacation({ start: e.target.value })} />
              </label>
              <label>
                {t('Bis (optional)')}
                <input type="date" value={vacation.end} onChange={e => setVacation({ end: e.target.value })} />
              </label>
              <label>
                {t('Betreff')}
                <input
                  value={vacation.subject}
                  maxLength={200}
                  placeholder={t('Abwesend')}
                  onChange={e => setVacation({ subject: e.target.value })}
                />
              </label>
              <label>
                {t('Höchstens alle … Tage')}
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={vacation.days}
                  onChange={e => setVacation({ days: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </label>
            </div>
            <label>
              {t('Text')}
              <textarea
                rows={5}
                maxLength={4000}
                value={vacation.body}
                placeholder={t('Danke für deine Nachricht. Ich bin bis … nicht erreichbar. In dringenden Fällen …')}
                onChange={e => setVacation({ body: e.target.value })}
              />
            </label>
          </Section>
          <Section
            title={t('Filterregeln')}
            description={t('Werden der Reihe nach auf eingehende E-Mails angewendet – direkt auf dem Mailserver.')}
          >
            {config.rules.length === 0 && <p className="muted">{t('Noch keine Regeln.')}</p>}
            {config.rules.map((rule, i) => (
              <div className={`rule-card ${rule.enabled ? '' : 'disabled'}`} key={i}>
                <div className="rule-head">
                  <input
                    className="rule-name"
                    aria-label={t('Name der Regel')}
                    value={rule.name}
                    maxLength={80}
                    onChange={e => updateRule(i, { name: e.target.value })}
                  />
                  <label className="toggle small">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={e => updateRule(i, { enabled: e.target.checked })}
                    />{' '}
                    {t('aktiv')}
                  </label>
                  <button
                    className="icon-button"
                    aria-label={t('Nach oben')}
                    disabled={i === 0}
                    onClick={() => {
                      const r = [...config.rules];
                      [r[i - 1], r[i]] = [r[i], r[i - 1]];
                      update({ rules: r });
                    }}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('Nach unten')}
                    disabled={i === config.rules.length - 1}
                    onClick={() => {
                      const r = [...config.rules];
                      [r[i + 1], r[i]] = [r[i], r[i + 1]];
                      update({ rules: r });
                    }}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('Regel löschen')}
                    onClick={() => update({ rules: config.rules.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="rule-line">
                  <span>{t('Wenn')}</span>
                  <select value={rule.match} onChange={e => updateRule(i, { match: e.target.value as Rule['match'] })}>
                    <option value="all">{t('alle Bedingungen')}</option>
                    <option value="any">{t('eine der Bedingungen')}</option>
                  </select>
                  <span>{t('zutreffen:')}</span>
                </div>
                {rule.conditions.map((c, k) => (
                  <div className="rule-line" key={k}>
                    <select
                      aria-label={t('Feld')}
                      value={c.field}
                      onChange={e =>
                        updateRule(i, {
                          conditions: rule.conditions.map((x, j) =>
                            j === k ? { ...x, field: e.target.value as Condition['field'] } : x
                          )
                        })
                      }
                    >
                      {Object.entries(fieldLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('Vergleich')}
                      value={c.op}
                      onChange={e =>
                        updateRule(i, {
                          conditions: rule.conditions.map((x, j) =>
                            j === k ? { ...x, op: e.target.value as Condition['op'] } : x
                          )
                        })
                      }
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
                      onChange={e =>
                        updateRule(i, {
                          conditions: rule.conditions.map((x, j) => (j === k ? { ...x, value: e.target.value } : x))
                        })
                      }
                    />
                    {rule.conditions.length > 1 && (
                      <button
                        className="icon-button"
                        aria-label={t('Bedingung entfernen')}
                        onClick={() => updateRule(i, { conditions: rule.conditions.filter((_, j) => j !== k) })}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {rule.conditions.length < 10 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      updateRule(i, {
                        conditions: [...rule.conditions, { field: 'subject', op: 'contains', value: '' }]
                      })
                    }
                  >
                    + {t('Bedingung')}
                  </button>
                )}
                <div className="rule-line">
                  <span>{t('dann:')}</span>
                </div>
                {rule.actions.map((a, k) => (
                  <div className="rule-line" key={k}>
                    <select
                      aria-label={t('Aktion')}
                      value={a.type}
                      onChange={e =>
                        updateRule(i, {
                          actions: rule.actions.map((x, j) =>
                            j === k ? { type: e.target.value as RuleAction['type'], folder: x.folder } : x
                          )
                        })
                      }
                    >
                      {Object.entries(actionLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {a.type === 'move' && (
                      <select
                        aria-label={t('Zielordner')}
                        value={a.folder || ''}
                        onChange={e =>
                          updateRule(i, {
                            actions: rule.actions.map((x, j) => (j === k ? { ...x, folder: e.target.value } : x))
                          })
                        }
                      >
                        <option value="">{t('Ordner wählen …')}</option>
                        {folders.map(f => (
                          <option key={f.path} value={f.path}>
                            {f.path}
                          </option>
                        ))}
                      </select>
                    )}
                    {rule.actions.length > 1 && (
                      <button
                        className="icon-button"
                        aria-label={t('Aktion entfernen')}
                        onClick={() => updateRule(i, { actions: rule.actions.filter((_, j) => j !== k) })}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
                {rule.actions.length < 5 && (
                  <button
                    className="text-button"
                    onClick={() => updateRule(i, { actions: [...rule.actions, { type: 'markRead' }] })}
                  >
                    + {t('Aktion')}
                  </button>
                )}
                <label className="toggle small">
                  <input
                    type="checkbox"
                    checked={rule.stop}
                    onChange={e => updateRule(i, { stop: e.target.checked })}
                  />{' '}
                  {t('Danach keine weiteren Regeln anwenden')}
                </label>
              </div>
            ))}
            {config.rules.length < 50 && (
              <button
                className="btn small"
                onClick={() => update({ rules: [...config.rules, newRule(config.rules.length + 1)] })}
              >
                <Plus size={14} /> {t('Regel hinzufügen')}
              </button>
            )}
          </Section>
          <div className="settings-sticky-actions">
            {state.foreignActive && (
              <small className="muted">
                {t('Auf dem Server aktiv: „{name}“ (nicht von Levuvo).', { name: state.foreignActive })}
              </small>
            )}
            {!dirty && !state.foreignActive && (
              <small className="ok-text">
                <Check size={13} /> {t('Gespeichert')}
              </small>
            )}
            <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} {t('Auf dem Server speichern')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
