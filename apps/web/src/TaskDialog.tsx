// Create or edit a task; from the reader it is prefilled with the mail's subject and linked to it.
import { useEffect, useRef, useState } from 'react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { useFocusTrap } from './ui/focus';
import { useTaskLinks } from './TaskLists';
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
  Pick<
    Task,
    'id' | 'title' | 'notes' | 'due' | 'done' | 'remindAt' | 'priority' | 'repeat' | 'source' | 'list' | 'space'
  >
> & { mail?: TaskMailRef | null };

/** Spaces a task can be put into (where I am owner or editor). */
function useTaskSpaces() {
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    getJson<{ spaces: { id: string; name: string }[] }>('/api/tasks/spaces')
      .then(r => alive && setSpaces(r.spaces || []))
      .catch(() => alive && setSpaces([]));
    return () => {
      alive = false;
    };
  }, []);
  return spaces;
}

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
  const { toast, confirm } = useUi();
  const initial = formFromDue(draft.due ?? null);
  const [title, setTitle] = useState(draft.title || '');
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [notes, setNotes] = useState(draft.notes || '');
  const [priority, setPriority] = useState<TaskPriority>(draft.priority || 'none');
  const [remind, setRemind] = useState<ReminderChoice>(reminderChoice(draft.remindAt ?? null, draft.due ?? null));
  const [customRemind, setCustomRemind] = useState(localDateTime(draft.remindAt ?? null));
  const [repeat, setRepeat] = useState<string>(draft.repeat ? `${draft.repeat.freq}:${draft.repeat.interval}` : '');
  const [list, setList] = useState(draft.list || '');
  // An edit opened without the list (e.g. from the reader) leaves the task in its list.
  const [listTouched, setListTouched] = useState(false);
  const { links } = useTaskLinks();
  const spaces = useTaskSpaces();
  // A space task stays in its space; a task on this device (or in a list) can be put into one.
  const spaceTask = Boolean(draft.id && draft.space);
  const readOnly = Boolean(draft.space?.readOnly);
  const [space, setSpace] = useState(draft.space?.id || '');
  const inSpace = Boolean(space);
  const moving = Boolean(draft.id && !draft.space && space);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const trap = useFocusTrap<HTMLDivElement>();
  useEffect(() => {
    titleInput.current?.focus();
    titleInput.current?.select();
  }, []);
  const dirty =
    title !== (draft.title || '') ||
    date !== initial.date ||
    time !== initial.time ||
    notes !== (draft.notes || '') ||
    priority !== (draft.priority || 'none') ||
    remind !== reminderChoice(draft.remindAt ?? null, draft.due ?? null) ||
    repeat !== (draft.repeat ? `${draft.repeat.freq}:${draft.repeat.interval}` : '') ||
    listTouched ||
    space !== (draft.space?.id || '');
  // Backdrop and Escape must not silently throw away what was typed.
  async function requestClose() {
    if (
      !readOnly &&
      dirty &&
      !(await confirm({ title: t('Änderungen verwerfen?'), confirmLabel: t('Verwerfen'), danger: true }))
    )
      return;
    onClose();
  }
  const presets = duePresets();
  const due = dueFromForm(date, time);
  const timed = Boolean(due && time);

  async function save() {
    if (!title.trim()) {
      setError(t('Bitte einen Titel eingeben.'));
      return;
    }
    const remindAt = inSpace ? null : reminderFor(remind, due, customRemind);
    if (!inSpace && remind !== 'none' && !remindAt) {
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
            repeat: due && !inSpace ? rep : null,
            list: inSpace || (draft.id && !listTouched && draft.list === undefined) ? undefined : list || null,
            // Only new tasks and moves name a space; a space task stays where it is.
            space: spaceTask ? undefined : space || null,
            done: draft.done === true,
            mail: draft.mail || null,
            source: draft.source
          }
        },
        'mail-v1'
      );
      toast({
        text: moving
          ? t('Aufgabe in den Raum verschoben.')
          : draft.id
            ? t('Aufgabe gespeichert.')
            : t('Aufgabe angelegt.'),
        kind: 'success'
      });
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
  // A space knows low, normal and high: "Mittel" is not offered there.
  const priorities: [TaskPriority, string][] = (
    [
      ['none', inSpace ? t('Normal') : t('Keine')],
      ['low', t('Niedrig')],
      ['medium', t('Mittel')],
      ['high', t('Hoch')]
    ] as [TaskPriority, string][]
  ).filter(([p]) => !(inSpace && p === 'medium'));

  return (
    <div
      className="modal-scrim confirm-scrim"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) void requestClose();
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
            void requestClose();
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
          <h2 id="task-dialog-title">
            {readOnly ? t('Aufgabe') : draft.id ? t('Aufgabe bearbeiten') : t('Neue Aufgabe')}
          </h2>
          {readOnly && (
            <p className="task-dialog-note" role="note">
              {t('Nur lesen: In diesem Raum hast du die Rolle Leser.')}
            </p>
          )}
          <fieldset className="task-dialog-fields" disabled={readOnly}>
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
            {!inSpace && (
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
            )}
            {!inSpace && remind === 'custom' && (
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
            {(spaces.length > 0 || spaceTask) && (
              <label className="dialog-field">
                {t('Raum')}
                <select
                  value={space}
                  disabled={spaceTask}
                  aria-describedby={inSpace && !readOnly ? 'task-dialog-space-hint' : undefined}
                  onChange={e => {
                    setSpace(e.target.value);
                    if (e.target.value && priority === 'medium') setPriority('none');
                  }}
                >
                  <option value="">{t('Kein Raum')}</option>
                  {spaceTask && draft.space && !spaces.some(sp => sp.id === draft.space!.id) && (
                    <option value={draft.space.id}>{draft.space.name}</option>
                  )}
                  {spaces.map(sp => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {inSpace && !readOnly && (
              <p id="task-dialog-space-hint" className="task-dialog-note">
                {spaceTask
                  ? t('Änderungen gehen verschlüsselt an alle Mitglieder des Raums.')
                  : moving
                    ? t(
                        'Die Aufgabe wird in den Raum verschoben und dir zugewiesen. Alle Mitglieder sehen sie. Erinnerung, Wiederholung, Liste und der Link zur E-Mail entfallen.'
                      )
                    : t('Die Aufgabe wird im Raum angelegt und dir zugewiesen. Alle Mitglieder sehen sie.')}
              </p>
            )}
            {!inSpace && (links.length > 0 || list) && (
              <label className="dialog-field">
                {t('Liste')}
                <select
                  value={list}
                  onChange={e => {
                    setList(e.target.value);
                    setListTouched(true);
                  }}
                >
                  <option value="">{t('Auf diesem Gerät')}</option>
                  {links.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.accountLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="dialog-field">
              {t('Notiz')}
              <textarea rows={3} value={notes} maxLength={10_000} onChange={e => setNotes(e.target.value)} />
            </label>
          </fieldset>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={onClose}>
              {readOnly ? t('Schließen') : t('Abbrechen')}
            </button>
            {!readOnly && (
              <button type="submit" className="btn primary" disabled={busy}>
                {t('Speichern')}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
