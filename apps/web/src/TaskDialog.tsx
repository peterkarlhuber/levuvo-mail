// Create or edit a task; from the reader it is prefilled with the mail's subject and linked to it.
import { useEffect, useRef, useState } from 'react';
import { postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { useFocusTrap } from './ui/focus';
import {
  dueFromForm,
  duePresets,
  formFromDue,
  localDateTime,
  reminderChoice,
  reminderFor,
  type ReminderChoice,
  type Task,
  type TaskMailRef,
  type TaskPriority,
  type TaskRepeat
} from './tasks';

export type TaskDraft = Partial<
  Pick<Task, 'id' | 'title' | 'notes' | 'due' | 'done' | 'remindAt' | 'priority' | 'repeat' | 'source'>
> & { mail?: TaskMailRef | null };

export const tasksChanged = () => window.dispatchEvent(new CustomEvent('levuvo:tasks-changed'));

export default function TaskDialog({
  draft,
  onClose,
  onSaved
}: {
  draft: TaskDraft;
  onClose: () => void;
  onSaved?: (task: Task) => void;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const initial = formFromDue(draft.due ?? null);
  const [title, setTitle] = useState(draft.title || '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [notes, setNotes] = useState(draft.notes || '');
  const [priority, setPriority] = useState<TaskPriority>(draft.priority || 'none');
  const [remind, setRemind] = useState<ReminderChoice>(reminderChoice(draft.remindAt ?? null, draft.due ?? null));
  const [customRemind, setCustomRemind] = useState(localDateTime(draft.remindAt ?? null));
  const [repeat, setRepeat] = useState<string>(draft.repeat ? `${draft.repeat.freq}:${draft.repeat.interval}` : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const trap = useFocusTrap<HTMLDivElement>();
  useEffect(() => {
    titleInput.current?.focus();
    titleInput.current?.select();
  }, []);
  const presets = duePresets();
  const due = dueFromForm(date, time);
  const timed = Boolean(due && time);

  async function save() {
    if (!title.trim()) {
      setError(t('Bitte einen Titel eingeben.'));
      return;
    }
    const remindAt = reminderFor(remind, due, customRemind);
    if (remind !== 'none' && !remindAt) {
      setError(t('Für diese Erinnerung bitte ein Datum wählen.'));
      return;
    }
    const [freq, interval] = repeat.split(':');
    const rep: TaskRepeat = repeat
      ? { freq: freq as NonNullable<TaskRepeat>['freq'], interval: Number(interval) }
      : null;
    setBusy(true);
    try {
      const r = await postJson<{ task: Task }>(
        '/api/tasks/save',
        {
          task: {
            id: draft.id,
            title: title.trim(),
            notes,
            due,
            remindAt,
            priority,
            repeat: due ? rep : null,
            done: draft.done === true,
            mail: draft.mail || null,
            source: draft.source
          }
        },
        'mail-v1'
      );
      toast({ text: draft.id ? t('Aufgabe gespeichert.') : t('Aufgabe angelegt.'), kind: 'success' });
      tasksChanged();
      onSaved?.(r.task);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const preset = (label: string, value: string) => (
    <button type="button" className={`chip ${date === value ? 'active' : ''}`} onClick={() => setDate(value)}>
      {label}
    </button>
  );
  const priorities: [TaskPriority, string][] = [
    ['none', t('Keine')],
    ['low', t('Niedrig')],
    ['medium', t('Mittel')],
    ['high', t('Hoch')]
  ];

  return (
    <div
      className="modal-scrim confirm-scrim"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trap}
        className="confirm-card task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <form
          className="task-dialog-form"
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 id="task-dialog-title">{draft.id ? t('Aufgabe bearbeiten') : t('Neue Aufgabe')}</h2>
          {draft.mail && (
            <p className="task-dialog-mail">
              {t('Aus der E-Mail')}: „{draft.mail.subject || t('(Ohne Betreff)')}“
            </p>
          )}
          <label className="dialog-field">
            {t('Titel')}
            <input
              ref={titleInput}
              data-autofocus
              value={title}
              maxLength={300}
              onChange={e => {
                setTitle(e.target.value);
                setError('');
              }}
            />
          </label>
          <div className="dialog-field">
            {t('Fällig')}
            <div className="task-due-presets">
              {preset(t('Heute'), presets.today)}
              {preset(t('Morgen'), presets.tomorrow)}
              {preset(t('Montag'), presets.monday)}
              {preset(t('In einer Woche'), presets.week)}
              <button
                type="button"
                className={`chip ${!date ? 'active' : ''}`}
                onClick={() => {
                  setDate('');
                  setTime('');
                  setRepeat('');
                }}
              >
                {t('Ohne Datum')}
              </button>
            </div>
            <div className="task-due-inputs">
              <input type="date" aria-label={t('Datum')} value={date} onChange={e => setDate(e.target.value)} />
              <input
                type="time"
                aria-label={t('Uhrzeit (optional)')}
                value={time}
                disabled={!date}
                onChange={e => setTime(e.target.value)}
              />
            </div>
          </div>
          <div className="task-dialog-row">
            <label className="dialog-field">
              {t('Erinnerung')}
              <select value={remind} onChange={e => setRemind(e.target.value as ReminderChoice)}>
                <option value="none">{t('Keine')}</option>
                {timed && <option value="atDue">{t('Zur Fälligkeit')}</option>}
                {timed && <option value="before15">{t('15 Minuten vorher')}</option>}
                {timed && <option value="before60">{t('1 Stunde vorher')}</option>}
                {date && <option value="morning">{t('Am Tag um 9:00')}</option>}
                {date && <option value="dayBefore">{t('Am Vortag um 9:00')}</option>}
                <option value="custom">{t('Eigene Zeit …')}</option>
              </select>
            </label>
            <label className="dialog-field">
              {t('Wiederholen')}
              <select value={date ? repeat : ''} disabled={!date} onChange={e => setRepeat(e.target.value)}>
                <option value="">{t('Nie')}</option>
                <option value="DAILY:1">{t('Täglich')}</option>
                <option value="WEEKLY:1">{t('Wöchentlich')}</option>
                <option value="WEEKLY:2">{t('Alle zwei Wochen')}</option>
                <option value="MONTHLY:1">{t('Monatlich')}</option>
                <option value="MONTHLY:3">{t('Vierteljährlich')}</option>
                <option value="YEARLY:1">{t('Jährlich')}</option>
              </select>
            </label>
          </div>
          {remind === 'custom' && (
            <input
              type="datetime-local"
              aria-label={t('Erinnerung')}
              value={customRemind}
              onChange={e => setCustomRemind(e.target.value)}
            />
          )}
          <div className="dialog-field">
            {t('Priorität')}
            <div className="segmented task-priority" role="group" aria-label={t('Priorität')}>
              {priorities.map(([p, label]) => (
                <button
                  type="button"
                  key={p}
                  className={`prio-${p} ${priority === p ? 'active' : ''}`}
                  aria-pressed={priority === p}
                  onClick={() => setPriority(p)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="dialog-field">
            {t('Notiz')}
            <textarea rows={3} value={notes} maxLength={10_000} onChange={e => setNotes(e.target.value)} />
          </label>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('Abbrechen')}
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {t('Speichern')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
