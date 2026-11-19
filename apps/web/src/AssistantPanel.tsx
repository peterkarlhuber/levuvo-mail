// The collapsible panel of the Levuvo Mail Assistant (Ctrl/⌘+J): ask the mailbox, give the assistant a
// task, start a routine, and approve what agents prepared. Every answer is marked as AI-generated.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusTrap } from './ui/focus';
import { CircleCheck, LoaderCircle, Paperclip, Play, Send, Sparkles, Trash2, X } from 'lucide-react';
import { ApiError, getJson, postJson } from './api';
import { aiEnabled, aiErrorText, runAi } from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { dateLabel } from './format';
import { Button, Field, IconButton, Segmented } from './ui';
import { ApprovalList } from './SettingsMcp';

type Skill = {
  id: string;
  name: string;
  hint: string;
  level: 'read' | 'draft';
  builtin: boolean;
  param?: { name: string; label: string };
};
type Source = {
  accountId: string;
  folder: string;
  uid: number;
  subject: string;
  fromName?: string;
  fromEmail?: string;
  date?: string;
  quote?: string;
  attachment?: string;
};
type Entry =
  | {
      id: number;
      kind: 'ask';
      prompt: string;
      busy: boolean;
      answer?: string;
      found?: boolean;
      sources?: Source[];
      model?: string;
      error?: string;
    }
  | {
      id: number;
      kind: 'task';
      prompt: string;
      busy: boolean;
      report?: string;
      steps?: number;
      newApprovals?: number;
      model?: string;
      error?: string;
    };

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenMessage: (s: Source) => void;
  onOpenSettings: () => void;
  onPending: (n: number) => void;
};

export function AssistantPanel({ open, onClose, onOpenMessage, onOpenSettings, onPending }: Props) {
  const { t, lang } = useT();
  const { prompt } = useUi();
  const [enabled, setEnabled] = useState<{ search: boolean; agents: boolean } | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [mode, setMode] = useState<'ask' | 'task'>('ask');
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const seq = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const trap = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    void Promise.all([aiEnabled('search'), aiEnabled('agents')]).then(([search, agents]) => {
      setEnabled({ search, agents });
      if (!search && agents) setMode('task');
    });
    void getJson<{ skills: Skill[] }>('/api/ai/skills')
      .then(r => setSkills(r.skills))
      .catch(() => {});
    window.setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const update = useCallback((id: number, patch: Partial<Entry>) => {
    setEntries(list => list.map(e => (e.id === id ? ({ ...e, ...patch } as Entry) : e)));
  }, []);

  async function ask(question: string) {
    const id = ++seq.current;
    // The last answered questions go along, so a follow-up like "and the price?" is understood.
    const history = entries
      .filter(e => e.kind === 'ask' && e.answer)
      .slice(-2)
      .map(e => ({ question: e.prompt, answer: e.kind === 'ask' ? e.answer : '' }));
    setEntries(list => [...list, { id, kind: 'ask', prompt: question, busy: true }]);
    try {
      const r = await runAi<{ answer: string; found: boolean; sources: Source[] }>('ask', {
        input: { question, history },
        lang
      });
      update(id, {
        busy: false,
        answer: r.result.answer,
        found: r.result.found,
        sources: r.result.sources,
        model: r.model
      });
    } catch (err) {
      update(id, { busy: false, error: aiErrorText(err instanceof ApiError ? err.code : undefined, t) });
    }
  }

  async function task(body: Record<string, unknown>, label: string) {
    const id = ++seq.current;
    setEntries(list => [...list, { id, kind: 'task', prompt: label, busy: true }]);
    try {
      const r = await postJson<{ report: string; steps: unknown[]; newApprovals: number; model: string }>(
        '/api/ai/agent',
        { ...body, lang, now: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        'ai-v1'
      );
      update(id, {
        busy: false,
        report: r.report,
        steps: r.steps.length,
        newApprovals: r.newApprovals,
        model: r.model
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      update(id, { busy: false, error: code ? aiErrorText(code, t) : t((err as Error).message) });
    }
  }

  async function runSkill(skill: Skill) {
    let params: Record<string, string> = {};
    if (skill.param) {
      const value = await prompt({
        title: skill.builtin ? t(skill.name) : skill.name,
        label: t(skill.param.label),
        confirmLabel: t('Starten'),
        validate: v => (v.trim() ? null : t('Bitte die Angabe ergänzen.'))
      });
      if (!value) return;
      params = { [skill.param.name]: value };
    }
    void task({ skill: skill.id, params }, skill.builtin ? t(skill.name) : skill.name);
  }

  function submit() {
    const value = text.trim();
    if (!value) return;
    setText('');
    if (mode === 'ask') void ask(value);
    else void task({ instruction: value }, value);
  }

  if (!open) return null;
  const off = enabled && !enabled.search && !enabled.agents;
  return (
    <>
      {/* A drawer over the app (WCAG 2.4.3/2.4.11): modal, Escape closes it, focus returns to the opener. */}
      <div className="assistant-scrim" role="presentation" onMouseDown={onClose} />
      <div
        ref={trap}
        className="assistant-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="assistant-head">
          <Sparkles size={16} aria-hidden="true" />
          <h2 id="assistant-title" className="assistant-title">
            {t('Levuvo Mail Assistant')}
          </h2>
          <span className="ai-label">{t('KI')}</span>
          <IconButton label={t('Schließen')} icon={<X size={16} />} onClick={onClose} />
        </header>
        {off ? (
          <div className="assistant-body">
            <p>
              {t(
                'Der Assistent ist ausgeschaltet. Er arbeitet standardmäßig mit einem lokalen Modell auf diesem Computer.'
              )}
            </p>
            <Button variant="primary" onClick={onOpenSettings}>
              {t('KI-Einstellungen öffnen')}
            </Button>
            <ApprovalSection onPending={onPending} />
          </div>
        ) : (
          <>
            <div className="assistant-body">
              {enabled?.agents && skills.length > 0 && (
                <div className="assistant-skills" role="list" aria-label={t('Routinen')}>
                  {skills.map(s => (
                    <button
                      key={s.id}
                      role="listitem"
                      className="chip"
                      title={s.builtin ? t(s.hint) : s.hint}
                      onClick={() => void runSkill(s)}
                    >
                      <Play size={12} /> {s.builtin ? t(s.name) : s.name}
                    </button>
                  ))}
                </div>
              )}
              {entries.length === 0 && (
                <p className="ai-hint">
                  {t(
                    'Frag zum Beispiel „Was hat Müller zum Angebot gesagt?“ oder gib eine Aufgabe wie „Kläre mit Anna einen Termin nächste Woche“. Gesucht wird auch in PDF- und Textanhängen, Rückfragen beziehen sich auf die vorige Antwort. Gesendet wird nichts ohne deine Freigabe.'
                  )}
                </p>
              )}
              {/* Answers, progress and errors are announced to screen readers as they arrive (WCAG 4.1.3). */}
              <div
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label={t('Verlauf des Assistenten')}
              >
                {entries.map(e => (
                  <div key={e.id} className="assistant-entry">
                    <div className="assistant-prompt">{e.prompt}</div>
                    {e.busy && (
                      <div className="ai-hint">
                        <LoaderCircle className="spin" size={14} />{' '}
                        {e.kind === 'ask' ? t('Sucht im Postfach…') : t('Arbeitet…')}
                      </div>
                    )}
                    {e.error && (
                      <div className="reader-security warning" role="alert">
                        {e.error}
                      </div>
                    )}
                    {e.kind === 'ask' && e.answer && (
                      <div className="assistant-answer">
                        <p className={e.found === false ? 'ai-hint' : undefined}>{e.answer}</p>
                        {e.sources && e.sources.length > 0 && (
                          <ul className="assistant-sources">
                            {e.sources.map(s => (
                              <li key={`${s.accountId}:${s.folder}:${s.uid}`}>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    onClose();
                                    onOpenMessage(s);
                                  }}
                                >
                                  {s.subject || t('(ohne Betreff)')}
                                </button>
                                <span className="assistant-source-meta">
                                  {[s.fromName || s.fromEmail, s.date ? dateLabel(s.date) : '']
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                                {s.quote && (
                                  <blockquote className="assistant-quote">
                                    {s.attachment && (
                                      <span className="assistant-quote-file">
                                        <Paperclip size={11} aria-hidden="true" /> {s.attachment}
                                      </span>
                                    )}
                                    „{s.quote}“
                                  </blockquote>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <span className="ai-label">
                          <Sparkles size={11} /> {t('KI-generiert')} · {e.model}
                        </span>
                      </div>
                    )}
                    {e.kind === 'task' && e.report && (
                      <div className="assistant-answer">
                        <p className="assistant-report">{e.report}</p>
                        {Boolean(e.newApprovals) && (
                          <p className="ai-hint">
                            <CircleCheck size={13} />{' '}
                            {t('{count} Freigaben warten unten auf dich.', { count: e.newApprovals || 0 })}
                          </p>
                        )}
                        <span className="ai-label">
                          <Sparkles size={11} /> {t('KI-generiert')} · {e.model} ·{' '}
                          {t('{count} Schritte', { count: e.steps || 0 })}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <ApprovalSection onPending={onPending} />
            </div>
            <form
              className="assistant-input"
              onSubmit={ev => {
                ev.preventDefault();
                submit();
              }}
            >
              <Segmented
                size="sm"
                label={t('Art')}
                value={mode}
                onChange={setMode}
                options={[
                  ...(enabled?.search !== false ? [{ value: 'ask' as const, label: t('Frage') }] : []),
                  ...(enabled?.agents !== false ? [{ value: 'task' as const, label: t('Aufgabe') }] : [])
                ]}
              />
              <Field hideLabel label={mode === 'ask' ? t('Frage an das Postfach') : t('Aufgabe für den Assistenten')}>
                <textarea
                  ref={input}
                  rows={2}
                  maxLength={2000}
                  value={text}
                  placeholder={mode === 'ask' ? t('Frag dein Postfach…') : t('Was soll der Assistent erledigen?')}
                  onChange={ev => setText(ev.target.value)}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter' && !ev.shiftKey) {
                      ev.preventDefault();
                      submit();
                    }
                  }}
                />
              </Field>
              <IconButton
                type="submit"
                className="primary"
                size="sm"
                label={t('Senden')}
                icon={<Send size={14} />}
                disabled={!text.trim()}
              />
              {entries.length > 0 && (
                <IconButton
                  size="sm"
                  label={t('Verlauf leeren')}
                  icon={<Trash2 size={14} />}
                  onClick={() => setEntries([])}
                />
              )}
            </form>
          </>
        )}
      </div>
    </>
  );
}

function ApprovalSection({ onPending }: { onPending: (n: number) => void }) {
  const { t } = useT();
  const [count, setCount] = useState(0);
  const refresh = useCallback(
    () =>
      getJson<{ pending: unknown[] }>('/api/mcp/approvals')
        .then(r => {
          setCount(r.pending.length);
          onPending(r.pending.length);
        })
        .catch(() => {}),
    [onPending]
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="assistant-approvals" aria-label={t('Freigaben')}>
      <h3>
        {t('Freigaben')} {count > 0 && <span className="badge">{count}</span>}
      </h3>
      <ApprovalList onChange={() => void refresh()} />
    </section>
  );
}

/** Pending approvals for the badge on the rail, polled while the AI is switched on. */
export function usePendingApprovals() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getJson<{ pending: unknown[] }>('/api/mcp/approvals');
        if (alive) setPending(r.pending.length);
      } catch {
        /* offline */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return [pending, setPending] as const;
}
