// Shared spaces ("Räume"): one place per topic, project or customer with notes, mails,
// tasks, events and files, shared end-to-end encrypted over the members' own mailboxes.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  CalendarDays,
  Check,
  CheckSquare,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  Mail,
  MessageCircle,
  MessageSquare,
  Plus,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  StickyNote,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react';
import { download } from './api';
import { Button, Field, IconButton, Segmented, PageTitle } from './ui';
import { useUi } from './ConfirmDialog';
import { Row, Section, Toggle } from './ui/SettingsLayout';
import { dateLabel, dueDateLabel, fullDateLabel, initials, prettySize } from './format';
import { useT } from './i18n';
import type { AccountItem } from './types';
import {
  newId,
  spaces,
  type Activity,
  type Comment,
  type Member,
  type SpaceDetail,
  type SpaceList,
  type Target,
  type Task
} from './spaces-api';

const NoteEditor = lazy(() => import('./SpaceNoteEditor'));
const SpaceChat = lazy(() => import('./SpaceChat'));
type Tab = 'overview' | 'chat' | 'notes' | 'mails' | 'tasks' | 'events' | 'files' | 'members' | 'settings';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function useActivityText() {
  const { t } = useT();
  return (a: Activity) => {
    const map: Record<string, string> = {
      'space.create': t('hat den Raum angelegt'),
      'space.update': t('hat den Raum umbenannt oder beschrieben'),
      'space.transfer': t('hat den Raum übergeben'),
      'space.dissolve': t('hat den Raum aufgelöst'),
      'ai.settings':
        a.detail === 'cloud_on'
          ? t('hat Cloud-KI und externe Agenten für den Raum erlaubt')
          : a.detail === 'cloud_off'
            ? t('hat Cloud-KI und externe Agenten für den Raum wieder ausgeschlossen')
            : t('hat die Assistent-Einstellungen geändert'),
      'member.add': t('hat {name} aufgenommen', { name: a.label }),
      'member.role': t('hat die Rolle von {name} geändert', { name: a.label }),
      'member.remove': t('hat {name} entfernt', { name: a.label }),
      'member.leave': t('hat den Raum verlassen'),
      'note.create': t('hat eine Notiz angelegt'),
      'note.update': t('hat eine Notiz umbenannt'),
      'note.edit': t('hat eine Notiz bearbeitet'),
      'note.delete': t('hat eine Notiz gelöscht'),
      'mail.add': t('hat eine Mail hinzugefügt'),
      'mail.remove': t('hat eine Mail entfernt'),
      'comment.add': t('hat kommentiert'),
      'comment.edit': t('hat einen Kommentar bearbeitet'),
      'comment.delete': t('hat einen Kommentar gelöscht'),
      'task.upsert': t('hat eine Aufgabe bearbeitet'),
      'task.delete': t('hat eine Aufgabe gelöscht'),
      'event.upsert': t('hat einen Termin bearbeitet'),
      'event.delete': t('hat einen Termin gelöscht'),
      'file.add': t('hat eine Datei hochgeladen'),
      'file.version': t('hat eine neue Dateiversion hochgeladen'),
      'file.update': t('hat eine Datei umbenannt oder verschoben'),
      'file.delete': t('hat eine Datei gelöscht'),
      'folder.create': t('hat einen Ordner angelegt'),
      'folder.delete': t('hat einen Ordner gelöscht')
    };
    return map[a.type] || a.type;
  };
}

export default function SpacesModule({ accounts }: { accounts: AccountItem[] }) {
  const { t } = useT();
  const ui = useUi();
  const [list, setList] = useState<SpaceList | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const l = await spaces.list();
      setList(l);
      setError('');
      setSelected(s => s ?? l.spaces[0]?.id ?? null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await spaces.post('/sync');
      await reload();
    } catch (err) {
      ui.toast({ kind: 'error', text: errorText(err) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main className="spaces-module">
      <aside className="spaces-list" aria-label={t('Räume')}>
        <div className="contacts-head">
          <PageTitle>{t('Räume')}</PageTitle>
          <div className="spaces-head-tools">
            <IconButton
              onClick={() => void syncNow()}
              disabled={syncing}
              label={t('Jetzt abgleichen')}
              icon={<RefreshCcw size={16} className={syncing ? 'spin' : ''} />}
            />
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> {t('Neuer Raum')}
            </Button>
          </div>
        </div>
        {error && <p className="banner error">{error}</p>}
        {list?.updateNeeded && (
          <p className="banner warn" role="status">
            {t(
              'Ein Mitglied nutzt eine neuere Version von Levuvo Mail. Einige Abgleich-Mails werden erst nach einem Update gelesen; sie bleiben bis dahin aufbewahrt.'
            )}
          </p>
        )}
        {list?.invitations.map(inv => (
          <InvitationCard
            key={inv.id}
            inv={inv}
            accounts={accounts}
            onDone={id => (void reload(), id && setSelected(id))}
          />
        ))}
        <div className="spaces-rows">
          {list && !list.spaces.length && !list.invitations.length && (
            <div className="spaces-empty muted">
              <Users size={28} />
              <p>{t('Noch keine Räume. Lege einen an und lade andere per Mail ein.')}</p>
            </div>
          )}
          {list?.spaces.map(s => (
            <button
              key={s.id}
              className={`space-row ${selected === s.id ? 'active' : ''}`}
              onClick={() => setSelected(s.id)}
            >
              <span className="space-avatar" aria-hidden="true">
                {initials(s.name)}
              </span>
              <span className="space-row-text">
                <strong>{s.name || t('Raum')}</strong>
                <small className="muted">
                  {s.status === 'joining'
                    ? t('Beitritt wird bestätigt …')
                    : s.status === 'removed'
                      ? t('Du wurdest entfernt')
                      : s.status === 'dissolved'
                        ? t('Aufgelöst')
                        : s.status === 'left'
                          ? t('Verlassen')
                          : s.members === 1
                            ? t('1 Mitglied · {tasks} offen', { tasks: s.openTasks })
                            : t('{n} Mitglieder · {tasks} offen', { n: s.members, tasks: s.openTasks })}
                </small>
              </span>
              {s.unreadChat > 0 && (
                <span className="space-unread" title={t('{n} ungelesene Chat-Nachrichten', { n: s.unreadChat })}>
                  {s.unreadChat > 99 ? '99+' : s.unreadChat}
                  <span className="sr-only">{t('{n} ungelesene Chat-Nachrichten', { n: s.unreadChat })}</span>
                </span>
              )}
              {s.sendError && (
                <span className="space-dot warn" title={t('Versand wird wiederholt')}>
                  <span className="sr-only">{t('Versand wird wiederholt')}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>
      <section className="space-main">
        {creating ? (
          <CreateSpace
            accounts={accounts}
            onCancel={() => setCreating(false)}
            onCreated={id => {
              setCreating(false);
              setSelected(id);
              void reload();
            }}
          />
        ) : selected ? (
          <SpaceView
            key={selected}
            id={selected}
            onChanged={reload}
            onGone={() => (setSelected(null), void reload())}
          />
        ) : (
          <div className="space-placeholder muted">
            <Users size={36} />
            <p>
              {t(
                'Ein Raum sammelt alles zu einem Thema: Notizen, Mails, Aufgaben, Termine und Dateien. Alle Mitglieder haben eine verschlüsselte Kopie, der Abgleich läuft über eure Postfächer.'
              )}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function InvitationCard({
  inv,
  accounts,
  onDone
}: {
  inv: SpaceList['invitations'][number];
  accounts: AccountItem[];
  onDone: (id?: string) => void;
}) {
  const { t } = useT();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    try {
      const r = await spaces.post<{ id: string }>(`/invitations/${inv.id}/accept`, { accountId: inv.accountId });
      ui.toast({
        kind: 'success',
        text: t('Beitritt angefragt. Sobald {name} bestätigt, erscheint der Inhalt.', {
          name: inv.from.name || inv.from.email
        })
      });
      onDone(r.id);
    } catch (err) {
      ui.toast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    await spaces.post(`/invitations/${inv.id}/decline`).catch(() => {});
    onDone();
  };
  const account = accounts.find(a => a.id === inv.accountId);
  return (
    <div className="space-invite">
      <strong>{t('Einladung: {name}', { name: inv.name })}</strong>
      <span className="muted">
        {t('von {from}', { from: inv.from.name ? `${inv.from.name} <${inv.from.email}>` : inv.from.email })} ·{' '}
        {inv.role === 'reader' ? t('Leser') : t('Bearbeiter')}
        {account ? ` · ${account.label}` : ''}
      </span>
      {inv.description && <span className="muted">{inv.description}</span>}
      {inv.fromMismatch && (
        <span className="banner warn">
          {t('Achtung: Die Mail kam von einer anderen Adresse als der des Einladenden.')}
        </span>
      )}
      <span className="muted small" title={t('Zum Vergleich mit dem Einladenden, z. B. am Telefon')}>
        <ShieldCheck size={12} /> {inv.safetyCode}
      </span>
      {inv.expired ? (
        <span className="muted">{t('Diese Einladung ist abgelaufen. Bitte um eine neue.')}</span>
      ) : (
        <div className="space-invite-actions">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void accept()}>
            <Check size={14} /> {t('Beitreten')}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void decline()}>
            {t('Ablehnen')}
          </Button>
        </div>
      )}
    </div>
  );
}

function CreateSpace({
  accounts,
  onCancel,
  onCreated
}: {
  accounts: AccountItem[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useT();
  const configured = accounts.filter(a => a.configured);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accountId, setAccountId] = useState(configured[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await spaces.post<{ id: string }>('/create', { name, description, accountId });
      onCreated(r.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-form"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>{t('Neuer Raum')}</h2>
      <Field label={t('Name')}>
        <input
          autoFocus
          value={name}
          maxLength={120}
          onChange={e => setName(e.target.value)}
          placeholder={t('z. B. Umbau Büro oder Kunde Müller')}
        />
      </Field>
      <Field label={t('Beschreibung')}>
        <textarea value={description} maxLength={2000} rows={3} onChange={e => setDescription(e.target.value)} />
      </Field>
      <Field label={t('Abgleich über das Konto')}>
        <select value={accountId} onChange={e => setAccountId(e.target.value)}>
          {configured.map(a => (
            <option key={a.id} value={a.id}>
              {a.label}
              {a.mailbox ? ` (${a.mailbox})` : ''}
            </option>
          ))}
        </select>
      </Field>
      <p className="muted">
        {t(
          'Änderungen werden Ende-zu-Ende-verschlüsselt als Mails von diesem Konto an die Mitglieder geschickt und landen dort im Ordner „Levuvo Spaces“.'
        )}
      </p>
      {error && <p className="banner error">{error}</p>}
      <div className="space-form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t('Abbrechen')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim() || !accountId}>
          {t('Raum anlegen')}
        </Button>
      </div>
    </form>
  );
}

function SpaceView({ id, onChanged, onGone }: { id: string; onChanged: () => void; onGone: () => void }) {
  const { t } = useT();
  const ui = useUi();
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

  const reload = useCallback(async () => {
    try {
      setDetail(await spaces.detail(id));
      setError('');
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 8_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  /** Runs a change and refreshes; errors become a toast. */
  const run = useCallback(
    async (fn: () => Promise<unknown>, done?: string) => {
      try {
        await fn();
        if (done) ui.toast({ kind: 'success', text: done });
        await reload();
        onChanged();
        return true;
      } catch (err) {
        ui.toast({ kind: 'error', text: errorText(err) });
        return false;
      }
    },
    [reload, onChanged, ui]
  );

  const onRead = useCallback(() => {
    void reload();
    onChanged();
  }, [reload, onChanged]);

  if (error && !detail) return <p className="banner error space-pad">{error}</p>;
  if (!detail)
    return (
      <div className="module-loading">
        <LoaderCircle className="spin" size={18} />
      </div>
    );

  const active = detail.status === 'active';
  const canEdit = active && (detail.role === 'owner' || detail.role === 'editor');
  const names: Record<string, string> = Object.fromEntries(
    detail.members.map(m => [m.id, m.me ? t('Du') : m.name || m.email])
  );
  const op = (type: string, data: unknown, done?: string) => run(() => spaces.op(id, type, data), done);
  const tabs: { id: Tab; label: string; icon: typeof Mail; count?: number }[] = [
    { id: 'overview', label: t('Übersicht'), icon: ActivityIcon },
    { id: 'chat', label: t('Chat'), icon: MessageCircle, count: detail.unreadChat },
    { id: 'notes', label: t('Notizen'), icon: StickyNote, count: detail.notes.length },
    { id: 'mails', label: t('Mails'), icon: Mail, count: detail.mails.length },
    {
      id: 'tasks',
      label: t('Aufgaben'),
      icon: CheckSquare,
      count: detail.tasks.filter(x => x.status !== 'done').length
    },
    { id: 'events', label: t('Termine'), icon: CalendarDays, count: detail.events.length },
    { id: 'files', label: t('Dateien'), icon: FileText, count: detail.files.length },
    { id: 'members', label: t('Mitglieder'), icon: Users, count: detail.members.filter(m => !m.removed).length },
    { id: 'settings', label: t('Einstellungen'), icon: Settings2 }
  ];

  return (
    <div className="space-view">
      <header className="space-header">
        <div>
          <h2>{detail.name}</h2>
          {detail.description && <p className="muted">{detail.description}</p>}
        </div>
        <span className="muted small">
          {detail.role === 'owner'
            ? t('Besitzer')
            : detail.role === 'editor'
              ? t('Bearbeiter')
              : detail.role === 'reader'
                ? t('Leser')
                : ''}
          {detail.pendingMails > 0 &&
            ` · ${detail.pendingMails === 1 ? t('1 Abgleich-Mail wartet') : t('{n} Abgleich-Mails warten', { n: detail.pendingMails })}`}
          {detail.ai.enabled && detail.ai.cloudAllowed && ` · ${t('Cloud-KI erlaubt')}`}
        </span>
      </header>
      {detail.status === 'joining' && (
        <p className="banner info">
          {t(
            'Der Beitritt wartet auf die Bestätigung durch den Besitzer. Das geht automatisch, sobald sein Levuvo Mail die Mail abruft.'
          )}
        </p>
      )}
      {detail.status === 'removed' && (
        <p className="banner warn">
          {t('Du wurdest aus diesem Raum entfernt. Neue Inhalte erreichen dich nicht mehr.')}
        </p>
      )}
      {detail.status === 'dissolved' && (
        <p className="banner warn">{t('Dieser Raum wurde aufgelöst und kann nur noch gelesen werden.')}</p>
      )}
      {detail.status === 'left' && <p className="banner warn">{t('Du hast diesen Raum verlassen.')}</p>}
      {detail.sendError && (
        <p className="banner warn">
          {t('Einige Abgleich-Mails konnten noch nicht gesendet werden. Levuvo Mail versucht es weiter.')}
        </p>
      )}
      {/* WAI-ARIA tabs: one tab stop, arrows/Home/End move and select, the panel is labelled by its tab. */}
      <nav
        className="space-tabs"
        role="tablist"
        aria-label={detail.name}
        onKeyDown={e => {
          const at = tabs.findIndex(x => x.id === tab);
          const next =
            e.key === 'ArrowRight'
              ? (at + 1) % tabs.length
              : e.key === 'ArrowLeft'
                ? (at - 1 + tabs.length) % tabs.length
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? tabs.length - 1
                    : -1;
          if (next < 0) return;
          e.preventDefault();
          setTab(tabs[next].id);
          document.getElementById(`space-tab-${tabs[next].id}`)?.focus();
        }}
      >
        {tabs.map(x => (
          <button
            key={x.id}
            id={`space-tab-${x.id}`}
            role="tab"
            aria-selected={tab === x.id}
            aria-controls="space-tabpanel"
            tabIndex={tab === x.id ? 0 : -1}
            className={`${tab === x.id ? 'active' : ''} ${x.id === 'settings' ? 'space-tab-settings' : ''}`}
            onClick={() => setTab(x.id)}
            title={x.id === 'settings' ? x.label : undefined}
            aria-label={x.id === 'settings' ? x.label : undefined}
          >
            <x.icon size={14} aria-hidden="true" />
            {x.id !== 'settings' && ` ${x.label}`}
            {x.count ? <span className="space-count">{x.count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="space-body" id="space-tabpanel" role="tabpanel" aria-labelledby={`space-tab-${tab}`}>
        {tab === 'overview' && <Overview detail={detail} names={names} onTab={setTab} />}
        {tab === 'chat' && (
          <Suspense
            fallback={
              <div className="module-loading">
                <LoaderCircle className="spin" size={18} />
              </div>
            }
          >
            <SpaceChat detail={detail} onRead={onRead} />
          </Suspense>
        )}
        {tab === 'notes' && <Notes detail={detail} canEdit={canEdit} run={run} op={op} />}
        {tab === 'mails' && <Mails detail={detail} names={names} canEdit={canEdit} op={op} />}
        {tab === 'tasks' && <Tasks detail={detail} names={names} canEdit={canEdit} op={op} />}
        {tab === 'events' && <Events detail={detail} names={names} canEdit={canEdit} op={op} />}
        {tab === 'files' && <Files detail={detail} names={names} canEdit={canEdit} run={run} op={op} />}
        {tab === 'members' && <Members detail={detail} run={run} />}
        {tab === 'settings' && <SpaceSettings detail={detail} run={run} op={op} onGone={onGone} />}
      </div>
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;
type Op = (type: string, data: unknown, done?: string) => Promise<boolean>;

function Overview({
  detail,
  names,
  onTab
}: {
  detail: SpaceDetail;
  names: Record<string, string>;
  onTab: (t: Tab) => void;
}) {
  const { t } = useT();
  const text = useActivityText();
  const mine = detail.tasks.filter(x => x.status !== 'done' && x.assignee === detail.me);
  const open = detail.tasks.filter(x => x.status !== 'done');
  const now = new Date().toISOString();
  const upcoming = detail.events.filter(e => (e.end || e.start) >= now.slice(0, 10)).slice(0, 5);
  return (
    <div className="space-overview">
      <div className="space-cards">
        <button className="space-card" onClick={() => onTab('chat')}>
          <strong>{detail.unreadChat}</strong>
          <span>{detail.unreadChat === 1 ? t('ungelesene Nachricht') : t('ungelesene Nachrichten')}</span>
        </button>
        <button className="space-card" onClick={() => onTab('tasks')}>
          <strong>{open.length}</strong>
          <span>{open.length === 1 ? t('offene Aufgabe') : t('offene Aufgaben')}</span>
          {mine.length > 0 && <small>{t('{n} für dich', { n: mine.length })}</small>}
        </button>
        <button className="space-card" onClick={() => onTab('events')}>
          <strong>{upcoming.length}</strong>
          <span>{upcoming.length === 1 ? t('kommender Termin') : t('kommende Termine')}</span>
          {upcoming[0] && <small>{upcoming[0].title}</small>}
        </button>
        <button className="space-card" onClick={() => onTab('files')}>
          <strong>{detail.files.length}</strong>
          <span>{detail.files.length === 1 ? t('Datei') : t('Dateien')}</span>
        </button>
      </div>
      <h3>{t('Aktivität')}</h3>
      <p className="muted small">
        {t('Zeigt, wer was wann geändert hat. Es gibt keine Auswertung oder Statistik über Personen.')}
      </p>
      <ul className="space-activity">
        {detail.activity.slice(0, 80).map(a => (
          <li key={a.op}>
            <span className="muted">{dateLabel(a.at)}</span> <strong>{names[a.by] || t('Unbekannt')}</strong> {text(a)}
            {a.label && a.type !== 'member.add' && a.type !== 'member.remove' && a.type !== 'member.role' && (
              <>
                : <em>{t('„{label}“', { label: a.label })}</em>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notes({ detail, canEdit, run, op }: { detail: SpaceDetail; canEdit: boolean; run: Run; op: Op }) {
  const { t } = useT();
  const ui = useUi();
  const [open, setOpen] = useState<string | null>(detail.notes[0]?.id ?? null);
  const note = detail.notes.find(n => n.id === open);
  const create = async () => {
    const title = await ui.prompt({ title: t('Neue Notiz'), label: t('Titel'), confirmLabel: t('Anlegen') });
    if (title === null) return;
    let created = '';
    await run(async () => {
      created = (await spaces.post<{ id: string }>(`/${detail.id}/notes/create`, { title })).id;
    });
    if (created) setOpen(created);
  };
  return (
    <div className="space-split">
      <div className="space-side">
        {canEdit && (
          <Button size="sm" onClick={() => void create()}>
            <Plus size={14} /> {t('Notiz')}
          </Button>
        )}
        {detail.notes.map(n => (
          <button
            key={n.id}
            className={`space-side-row ${open === n.id ? 'active' : ''}`}
            onClick={() => setOpen(n.id)}
          >
            <strong>{n.title || t('Ohne Titel')}</strong>
            <small className="muted">{dateLabel(n.updatedAt)}</small>
          </button>
        ))}
        {!detail.notes.length && <p className="muted">{t('Noch keine Notizen.')}</p>}
      </div>
      <div className="space-content">
        {note ? (
          <>
            <div className="space-note-head">
              <h3>{note.title || t('Ohne Titel')}</h3>
              {canEdit && (
                <IconButton
                  label={t('Notiz löschen')}
                  onClick={async () => {
                    if (
                      await ui.confirm({
                        title: t('Notiz löschen?'),
                        message: t('Die Notiz wird für alle Mitglieder gelöscht.'),
                        confirmLabel: t('Löschen'),
                        danger: true
                      })
                    )
                      void op('note.delete', { id: note.id });
                  }}
                  icon={<Trash2 size={15} />}
                />
              )}
            </div>
            <Suspense fallback={<LoaderCircle className="spin" size={16} />}>
              <NoteEditor key={note.id} spaceId={detail.id} noteId={note.id} readOnly={!canEdit} />
            </Suspense>
            <CommentThread detail={detail} target={{ kind: 'note', id: note.id }} canEdit={canEdit} op={op} />
          </>
        ) : (
          <p className="muted">
            {t('Wähle eine Notiz oder lege eine neue an. Mehrere Personen können gleichzeitig schreiben.')}
          </p>
        )}
      </div>
    </div>
  );
}

function CommentThread({
  detail,
  target,
  canEdit,
  op
}: {
  detail: SpaceDetail;
  target: Target;
  canEdit: boolean;
  op: Op;
}) {
  const { t } = useT();
  const ui = useUi();
  const [text, setText] = useState('');
  const comments = detail.comments.filter(c => c.target.kind === target.kind && c.target.id === target.id);
  const names = Object.fromEntries(detail.members.map(m => [m.id, m.me ? t('Du') : m.name || m.email]));
  const isMine = (c: Comment) => c.by === detail.me;
  return (
    <div className="space-comments">
      <h4>
        <MessageSquare size={13} /> {t('Interne Kommentare')}
      </h4>
      {comments.map(c => (
        <div key={c.id} className="space-comment">
          <span className="muted small">
            <strong>{names[c.by] || t('Unbekannt')}</strong> · {fullDateLabel(c.at)}
            {c.editedAt ? ` · ${t('bearbeitet')}` : ''}
          </span>
          <p>{c.text}</p>
          {(isMine(c) || detail.owner) && canEdit && (
            <button
              className="link-button small"
              onClick={async () => {
                if (
                  await ui.confirm({
                    title: t('Kommentar löschen?'),
                    message: t('Der Kommentar wird für alle Mitglieder gelöscht.'),
                    confirmLabel: t('Löschen'),
                    danger: true
                  })
                )
                  void op('comment.delete', { id: c.id });
              }}
            >
              {t('Löschen')}
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <form
          className="space-comment-form"
          onSubmit={async e => {
            e.preventDefault();
            if (!text.trim()) return;
            if (await op('comment.add', { id: newId(), target, text })) setText('');
          }}
        >
          <textarea
            rows={2}
            value={text}
            maxLength={20_000}
            onChange={e => setText(e.target.value)}
            placeholder={t('Kommentar für die Mitglieder (nicht an Externe)')}
          />
          <Button type="submit" size="sm" disabled={!text.trim()}>
            {t('Kommentieren')}
          </Button>
        </form>
      )}
    </div>
  );
}

function Mails({
  detail,
  names,
  canEdit,
  op
}: {
  detail: SpaceDetail;
  names: Record<string, string>;
  canEdit: boolean;
  op: Op;
}) {
  const { t } = useT();
  const ui = useUi();
  const [open, setOpen] = useState<string | null>(null);
  if (!detail.mails.length)
    return <p className="muted">{t('Noch keine Mails. Öffne eine Mail und wähle im Menü „In Raum legen“.')}</p>;
  return (
    <div className="space-mails">
      {detail.mails.map(m => (
        <div key={m.id} className={`space-mail ${open === m.id ? 'open' : ''}`}>
          <button className="space-mail-head" onClick={() => setOpen(open === m.id ? null : m.id)}>
            <strong>{m.subject || t('(kein Betreff)')}</strong>
            <span className="muted">
              {m.from?.name || m.from?.address} · {dateLabel(m.date)} ·{' '}
              {t('von {name} hinzugefügt', { name: names[m.addedBy] || '' })}
            </span>
          </button>
          {open === m.id && (
            <div className="space-mail-body">
              <pre>{m.text}</pre>
              {m.attachments.length > 0 && (
                <ul className="space-attachments">
                  {m.attachments.map((a, i) => (
                    <li key={i}>
                      {a.file ? (
                        <button
                          className="link-button"
                          onClick={() => download(`/api/spaces/${detail.id}/files/${a.file}`)}
                        >
                          <Download size={13} /> {a.name}
                        </button>
                      ) : (
                        <span className="muted">{a.name}</span>
                      )}{' '}
                      <small className="muted">{prettySize(a.size)}</small>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    if (
                      await ui.confirm({
                        title: t('Mail aus dem Raum entfernen?'),
                        message: t(
                          'Die Mail und ihre Kommentare werden für alle Mitglieder aus dem Raum entfernt. In deinem Postfach bleibt sie.'
                        ),
                        confirmLabel: t('Entfernen'),
                        danger: true
                      })
                    )
                      void op('mail.remove', { id: m.id });
                  }}
                >
                  <X size={13} /> {t('Aus dem Raum entfernen')}
                </Button>
              )}
              <CommentThread detail={detail} target={{ kind: 'mail', id: m.id }} canEdit={canEdit} op={op} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MemberSelect({
  detail,
  value,
  onChange,
  label
}: {
  detail: SpaceDetail;
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
}) {
  const { t } = useT();
  return (
    <select aria-label={label} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{t('Niemand')}</option>
      {detail.members
        .filter(m => !m.removed)
        .map(m => (
          <option key={m.id} value={m.id}>
            {m.me ? t('Ich') : m.name || m.email}
          </option>
        ))}
    </select>
  );
}

function Tasks({
  detail,
  names,
  canEdit,
  op
}: {
  detail: SpaceDetail;
  names: Record<string, string>;
  canEdit: boolean;
  op: Op;
}) {
  const { t } = useT();
  const ui = useUi();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine' | 'done'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const shown = detail.tasks
    .filter(x => (filter === 'done' ? x.status === 'done' : x.status !== 'done'))
    .filter(x => filter !== 'mine' || x.assignee === detail.me)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const statusLabel = (x: Task) =>
    x.status === 'doing' ? t('In Arbeit') : x.status === 'done' ? t('Erledigt') : t('Offen');
  return (
    <div className="space-tasks">
      {canEdit && (
        <form
          className="space-inline-form"
          onSubmit={async e => {
            e.preventDefault();
            if (!title.trim()) return;
            if (await op('task.upsert', { id: newId(), title, due: due || null, assignee })) {
              setTitle('');
              setDue('');
              setAssignee(null);
            }
          }}
        >
          <input
            value={title}
            maxLength={500}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('Neue Aufgabe')}
            aria-label={t('Neue Aufgabe')}
          />
          <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label={t('Fällig')} />
          <MemberSelect detail={detail} value={assignee} onChange={setAssignee} label={t('Zuständig')} />
          <Button type="submit" variant="primary" size="sm" disabled={!title.trim()}>
            <Plus size={14} /> {t('Hinzufügen')}
          </Button>
        </form>
      )}
      <Segmented
        label={t('Aufgaben filtern')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('Offen') },
          { value: 'mine', label: t('Für mich') },
          { value: 'done', label: t('Erledigt') }
        ]}
      />
      {!shown.length && <p className="muted">{t('Keine Aufgaben.')}</p>}
      <ul className="space-task-list">
        {shown.map(x => (
          <li key={x.id} className={`space-task ${x.status}`}>
            <input
              type="checkbox"
              checked={x.status === 'done'}
              disabled={!canEdit}
              aria-label={t('„{title}“ erledigt', { title: x.title })}
              onChange={e => void op('task.upsert', { id: x.id, status: e.target.checked ? 'done' : 'open' })}
            />
            <button className="space-task-title" onClick={() => setOpen(open === x.id ? null : x.id)}>
              <strong>{x.title}</strong>
              <small className="muted">
                {statusLabel(x)}
                {x.due ? ` · ${t('fällig {date}', { date: dueDateLabel(x.due) })}` : ''}
                {x.assignee ? ` · ${names[x.assignee] || ''}` : ''}
                {x.priority === 'high' ? ` · ${t('wichtig')}` : ''}
              </small>
            </button>
            {open === x.id && (
              <div className="space-task-detail">
                {canEdit && (
                  <div className="space-inline-form">
                    <select
                      aria-label={t('Status')}
                      value={x.status}
                      onChange={e => void op('task.upsert', { id: x.id, status: e.target.value })}
                    >
                      <option value="open">{t('Offen')}</option>
                      <option value="doing">{t('In Arbeit')}</option>
                      <option value="done">{t('Erledigt')}</option>
                    </select>
                    <MemberSelect
                      detail={detail}
                      value={x.assignee}
                      label={t('Zuständig')}
                      onChange={v => void op('task.upsert', { id: x.id, assignee: v })}
                    />
                    <input
                      type="date"
                      aria-label={t('Fällig')}
                      value={x.due?.slice(0, 10) || ''}
                      onChange={e => void op('task.upsert', { id: x.id, due: e.target.value || null })}
                    />
                    <select
                      aria-label={t('Priorität')}
                      value={x.priority}
                      onChange={e => void op('task.upsert', { id: x.id, priority: e.target.value })}
                    >
                      <option value="low">{t('Niedrig')}</option>
                      <option value="normal">{t('Normal')}</option>
                      <option value="high">{t('Wichtig')}</option>
                    </select>
                    <IconButton
                      label={t('Aufgabe löschen')}
                      onClick={async () => {
                        if (
                          await ui.confirm({
                            title: t('Aufgabe löschen?'),
                            message: t('Die Aufgabe wird für alle Mitglieder gelöscht.'),
                            confirmLabel: t('Löschen'),
                            danger: true
                          })
                        )
                          void op('task.delete', { id: x.id });
                      }}
                      icon={<Trash2 size={14} />}
                    />
                  </div>
                )}
                {x.notes && <p>{x.notes}</p>}
                <CommentThread detail={detail} target={{ kind: 'task', id: x.id }} canEdit={canEdit} op={op} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Events({
  detail,
  names,
  canEdit,
  op
}: {
  detail: SpaceDetail;
  names: Record<string, string>;
  canEdit: boolean;
  op: Op;
}) {
  const { t } = useT();
  const ui = useUi();
  const [title, setTitle] = useState('');
  const [day, setDay] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [location, setLocation] = useState('');
  const [everyone, setEveryone] = useState(true);
  const toIso = (d: string, time: string) => new Date(`${d}T${time}`).toISOString();
  return (
    <div className="space-events">
      {canEdit && (
        <form
          className="space-inline-form wrap"
          onSubmit={async e => {
            e.preventDefault();
            if (!title.trim() || !day) return;
            const allDay = !from;
            const ok = await op('event.upsert', {
              id: newId(),
              title,
              start: allDay ? day : toIso(day, from),
              end: allDay ? null : to ? toIso(day, to) : null,
              allDay,
              location,
              attendees: everyone ? detail.members.filter(m => !m.removed).map(m => m.id) : []
            });
            if (ok) {
              setTitle('');
              setDay('');
              setFrom('');
              setTo('');
              setLocation('');
            }
          }}
        >
          <input
            value={title}
            maxLength={500}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('Neuer Termin')}
            aria-label={t('Neuer Termin')}
          />
          <input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label={t('Datum')} />
          <input type="time" value={from} onChange={e => setFrom(e.target.value)} aria-label={t('Von')} />
          <input type="time" value={to} onChange={e => setTo(e.target.value)} aria-label={t('Bis')} />
          <input
            value={location}
            maxLength={500}
            onChange={e => setLocation(e.target.value)}
            placeholder={t('Ort')}
            aria-label={t('Ort')}
          />
          <label className="space-check">
            <input type="checkbox" checked={everyone} onChange={e => setEveryone(e.target.checked)} />{' '}
            {t('Alle Mitglieder')}
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={!title.trim() || !day}>
            <Plus size={14} /> {t('Hinzufügen')}
          </Button>
        </form>
      )}
      {!detail.events.length && <p className="muted">{t('Keine Termine.')}</p>}
      <ul className="space-event-list">
        {detail.events.map(ev => (
          <li key={ev.id}>
            <strong>{ev.title}</strong>
            <span className="muted">
              {ev.allDay ? dueDateLabel(ev.start.slice(0, 10)) : fullDateLabel(ev.start)}
              {ev.location ? ` · ${ev.location}` : ''}
              {ev.attendees.length
                ? ` · ${ev.attendees
                    .map(a => names[a] || '')
                    .filter(Boolean)
                    .join(', ')}`
                : ''}
            </span>
            {canEdit && (
              <IconButton
                label={t('Termin löschen')}
                onClick={async () => {
                  if (
                    await ui.confirm({
                      title: t('Termin löschen?'),
                      message: t('Der Termin wird für alle Mitglieder gelöscht.'),
                      confirmLabel: t('Löschen'),
                      danger: true
                    })
                  )
                    void op('event.delete', { id: ev.id });
                }}
                icon={<Trash2 size={14} />}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Files({
  detail,
  names,
  canEdit,
  run,
  op
}: {
  detail: SpaceDetail;
  names: Record<string, string>;
  canEdit: boolean;
  run: Run;
  op: Op;
}) {
  const { t } = useT();
  const ui = useUi();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const folders = useMemo(
    () => [...new Set([...detail.folders, ...detail.files.map(f => f.folder).filter(Boolean)])].sort(),
    [detail.folders, detail.files]
  );
  const shown = detail.files.filter(f => !folder || f.folder === folder);
  const upload = async (files: FileList | null, fileId = '') => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      if (file.size > 250 * 1024 * 1024) {
        ui.toast({ kind: 'error', text: t('Dateien in Räumen dürfen höchstens 250 MB groß sein.') });
        continue;
      }
      await run(() => spaces.upload(detail.id, file, { folder, fileId }), t('{name} hochgeladen', { name: file.name }));
    }
    setBusy(false);
  };
  // One hidden file input opened by real buttons, so upload works by keyboard (WCAG 2.1.1).
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef('');
  const pick = (fileId = '') => {
    target.current = fileId;
    if (picker.current) {
      picker.current.multiple = !fileId;
      picker.current.click();
    }
  };
  const fetchFile = (fileId: string, v?: number) => {
    // The server answers 409 while parts are still on their way from another member.
    void fetch(`/api/spaces/${detail.id}/files/${fileId}?check=1${v ? `&v=${v}` : ''}`, {
      method: 'GET',
      cache: 'no-store'
    }).then(async res => {
      if (res.ok) return download(`/api/spaces/${detail.id}/files/${fileId}${v ? `?v=${v}` : ''}`);
      const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
      // Only "parts are on their way" is temporary; anything else (damaged, gone, locked) is said as it is.
      if (body?.code === 'spaces_file_pending')
        ui.toast({
          kind: 'info',
          text: t('Die Datei wird gerade von einem anderen Mitglied geholt. Bitte gleich noch einmal versuchen.')
        });
      else ui.toast({ kind: 'error', text: body?.error ? t(body.error) : t('Aktion fehlgeschlagen.') });
    });
  };
  return (
    <div className="space-files">
      <div className="space-inline-form">
        <select aria-label={t('Ordner')} value={folder} onChange={e => setFolder(e.target.value)}>
          <option value="">{t('Alle Ordner')}</option>
          {folders.map(f => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {canEdit && (
          <>
            <Button
              size="sm"
              onClick={async () => {
                const name = await ui.prompt({
                  title: t('Neuer Ordner'),
                  label: t('Name'),
                  confirmLabel: t('Anlegen')
                });
                if (name) if (await op('folder.create', { path: name })) setFolder(name);
              }}
            >
              <Plus size={14} /> {t('Ordner')}
            </Button>
            <Button size="sm" variant="primary" busy={busy} icon={<Upload size={14} />} onClick={() => pick()}>
              {t('Hochladen')}
            </Button>
            <input
              ref={picker}
              type="file"
              hidden
              tabIndex={-1}
              onChange={e => void upload(e.target.files, target.current).then(() => (e.target.value = ''))}
            />
          </>
        )}
        {busy && <LoaderCircle className="spin" size={16} />}
      </div>
      <p className="muted small">
        {t(
          'Dateien werden verschlüsselt in Teilen von 5 MB übertragen, bis 250 MB pro Datei. Ältere Versionen bleiben abrufbar.'
        )}
      </p>
      {!shown.length && <p className="muted">{t('Keine Dateien.')}</p>}
      <ul className="space-file-list">
        {shown.map(f => {
          const latest = f.versions.at(-1);
          return (
            <li key={f.id}>
              <FileText size={16} />
              <div className="space-file-text">
                <strong>{f.name}</strong>
                <small className="muted">
                  {f.folder ? `${f.folder} · ` : ''}
                  {latest ? `${prettySize(latest.size)} · ${dateLabel(latest.at)} · ${names[latest.by] || ''}` : ''}
                  {f.versions.length > 1 ? ` · ${t('{n} Versionen', { n: f.versions.length })}` : ''}
                </small>
                {f.versions.length > 1 && (
                  <span className="space-versions">
                    {f.versions
                      .slice(0, -1)
                      .reverse()
                      .map(v => (
                        <button key={v.n} className="link-button small" onClick={() => fetchFile(f.id, v.n)}>
                          {t('Version {n}', { n: v.n })} ({dateLabel(v.at)})
                        </button>
                      ))}
                  </span>
                )}
              </div>
              <IconButton label={t('Herunterladen')} onClick={() => fetchFile(f.id)} icon={<Download size={15} />} />
              {canEdit && (
                <>
                  <IconButton
                    label={t('Neue Version hochladen')}
                    disabled={busy}
                    onClick={() => pick(f.id)}
                    icon={<Upload size={15} />}
                  />
                  <IconButton
                    label={t('Datei löschen')}
                    onClick={async () => {
                      if (
                        await ui.confirm({
                          title: t('Datei löschen?'),
                          message: t('Die Datei wird für alle Mitglieder gelöscht.'),
                          confirmLabel: t('Löschen'),
                          danger: true
                        })
                      )
                        void op('file.delete', { id: f.id });
                    }}
                    icon={<Trash2 size={15} />}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Members({ detail, run }: { detail: SpaceDetail; run: Run }) {
  const { t } = useT();
  const ui = useUi();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'reader'>('editor');
  const active = detail.status === 'active';
  const roleLabel = (m: Member) =>
    m.role === 'owner' ? t('Besitzer') : m.role === 'editor' ? t('Bearbeiter') : t('Leser');
  return (
    <div className="space-members">
      {detail.owner && active && (
        <form
          className="space-inline-form"
          onSubmit={async e => {
            e.preventDefault();
            const ok = await run(
              () => spaces.post(`/${detail.id}/invite`, { email, role }),
              t('Einladung an {email} wird gesendet.', { email })
            );
            if (ok) setEmail('');
          }}
        >
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={t('Mailadresse')}
            aria-label={t('Mailadresse')}
          />
          <select aria-label={t('Rolle')} value={role} onChange={e => setRole(e.target.value as 'editor' | 'reader')}>
            <option value="editor">{t('Bearbeiter')}</option>
            <option value="reader">{t('Leser')}</option>
          </select>
          <Button type="submit" variant="primary" size="sm" disabled={!email.includes('@')}>
            <Plus size={14} /> {t('Einladen')}
          </Button>
        </form>
      )}
      {detail.owner && (
        <p className="muted small">
          {t('Eingeladene brauchen Levuvo Mail. Sie bekommen eine Mail und wählen dort unter „Räume“ „Beitreten“.')}
        </p>
      )}
      <ul className="space-member-list">
        {detail.members
          .filter(m => !m.removed)
          .map(m => (
            <li key={m.id}>
              <span className="space-avatar small" aria-hidden="true">
                {initials(m.name || m.email)}
              </span>
              <div className="space-file-text">
                <strong>
                  {m.name || m.email}
                  {m.me ? ` (${t('du')})` : ''}
                </strong>
                <small className="muted">
                  {m.email} · {roleLabel(m)} ·{' '}
                  <span className="space-code">
                    <ShieldCheck size={11} /> {m.safetyCode}
                  </span>
                </small>
              </div>
              {detail.owner && active && !m.me && m.role !== 'owner' && (
                <>
                  <select
                    aria-label={t('Rolle')}
                    value={m.role}
                    onChange={e =>
                      void run(() => spaces.post(`/${detail.id}/members/${m.id}/role`, { role: e.target.value }))
                    }
                  >
                    <option value="editor">{t('Bearbeiter')}</option>
                    <option value="reader">{t('Leser')}</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="danger"
                    onClick={async () => {
                      const ok = await ui.confirm({
                        title: t('{name} entfernen?', { name: m.name || m.email }),
                        message: t(
                          'Der Schlüssel des Raums wird danach erneuert. {name} behält, was bereits da war, kann aber nichts Neues mehr lesen.',
                          { name: m.name || m.email }
                        ),
                        confirmLabel: t('Entfernen'),
                        danger: true
                      });
                      if (ok)
                        void run(
                          () => spaces.post(`/${detail.id}/members/${m.id}/remove`),
                          t('Entfernt. Der Schlüssel wird erneuert.')
                        );
                    }}
                  >
                    {t('Entfernen')}
                  </Button>
                </>
              )}
            </li>
          ))}
      </ul>
      {detail.invites.length > 0 && (
        <>
          <h4>{t('Offene Einladungen')}</h4>
          <ul className="space-member-list">
            {detail.invites.map(i => (
              <li key={i.email}>
                <div className="space-file-text">
                  <strong>{i.email}</strong>
                  <small className="muted">
                    {i.expired ? t('abgelaufen') : t('gültig bis {date}', { date: dateLabel(i.expires) })}
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void run(() => spaces.post(`/${detail.id}/invite/revoke`, { email: i.email }))}
                >
                  {t('Zurückziehen')}
                </Button>
                {i.expired && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void run(() => spaces.post(`/${detail.id}/invite`, { email: i.email, role: i.role }))
                    }
                  >
                    {t('Erneut einladen')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {detail.members.some(m => m.removed) && (
        <>
          <h4>{t('Ehemalige Mitglieder')}</h4>
          <ul className="space-member-list muted">
            {detail.members
              .filter(m => m.removed)
              .map(m => (
                <li key={m.id}>
                  {m.name || m.email} · {m.left ? t('ausgetreten') : t('entfernt')} {dateLabel(m.removed)}
                </li>
              ))}
          </ul>
        </>
      )}
      <SafetyCode code={detail.mySafetyCode} />
    </div>
  );
}

/** The own safety code, grouped and copyable, where members compare codes (Members tab). */
function SafetyCode({ code }: { code: string }) {
  const { t } = useT();
  const ui = useUi();
  const copy = () =>
    void navigator.clipboard
      ?.writeText(code)
      .then(() => ui.toast({ text: t('Kopiert.'), kind: 'info' }))
      .catch(() => undefined);
  return (
    <Section
      level={3}
      title={t('Sicherheitscodes')}
      description={t(
        'Sicherheitscodes könnt ihr z. B. am Telefon vergleichen. Stimmen sie überein, ist niemand dazwischen.'
      )}
    >
      <Row
        label={t('Dein Sicherheitscode')}
        hint={t('Diesen Code können andere mit dem vergleichen, den sie bei dir sehen.')}
      >
        <div className="settings-actions">
          <code className="safety-code" aria-label={code}>
            {code.split(' ').map((group, i) => (
              <span key={i}>{group}</span>
            ))}
          </code>
          <Button size="sm" onClick={copy}>
            <Copy size={14} /> {t('Kopieren')}
          </Button>
        </div>
      </Row>
    </Section>
  );
}

function SpaceSettings({ detail, run, op, onGone }: { detail: SpaceDetail; run: Run; op: Op; onGone: () => void }) {
  const { t } = useT();
  const ui = useUi();
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description);
  const [instructions, setInstructions] = useState(detail.ai.instructions);
  const [transferTo, setTransferTo] = useState('');
  const active = detail.status === 'active';
  const others = detail.members.filter(m => !m.removed && !m.me);
  const canWrite = active && (detail.role === 'owner' || detail.role === 'editor');
  const owner = detail.owner && active;
  const chatGrant = canWrite && detail.ai.enabled;
  const canDeleteCopy = !active && detail.status !== 'joining';
  // Fields save on their own when they lose focus, like everywhere else in Settings.
  const saveText = () => {
    const next = { name: name.trim(), description: description.trim() };
    if (!next.name) return setName(detail.name);
    if (next.name !== detail.name || next.description !== detail.description)
      void op('space.update', next, t('Gespeichert'));
  };
  const saveInstructions = () => {
    if (instructions.trim() !== detail.ai.instructions)
      void op('ai.settings', { instructions: instructions.trim() }, t('Gespeichert'));
  };
  const setCloud = async (on: boolean) => {
    // Sharing content with cloud models is a decision for everyone in the space: ask first.
    if (
      on &&
      !(await ui.confirm({
        title: t('Cloud-KI für diesen Raum erlauben?'),
        message: t(
          'Dann dürfen alle Inhalte dieses Raums, auch die der anderen Mitglieder, an das Cloud-Modell gehen, das in den KI-Einstellungen gewählt ist (Anthropic oder OpenAI), und an verbundene externe Agenten. Das gilt für alle Mitglieder, und alle sehen die Änderung in der Aktivität.'
        ),
        confirmLabel: t('Erlauben')
      }))
    )
      return;
    void op(
      'ai.settings',
      { cloudAllowed: on },
      on ? t('Cloud-KI für den Raum erlaubt.') : t('Cloud-KI für den Raum ausgeschlossen.')
    );
  };
  return (
    <div className="space-settings">
      {owner && (
        <Section level={3} title={t('Allgemein')} description={t('Änderungen werden automatisch gespeichert.')}>
          <Row label={t('Name')} wide>
            <input value={name} maxLength={120} required onChange={e => setName(e.target.value)} onBlur={saveText} />
          </Row>
          <Row label={t('Beschreibung')} wide>
            <textarea
              value={description}
              maxLength={2000}
              rows={3}
              onChange={e => setDescription(e.target.value)}
              onBlur={saveText}
            />
          </Row>
        </Section>
      )}
      {(owner || chatGrant) && (
        <Section level={3} title={t('Levuvo Mail Assistant in diesem Raum')}>
          {owner && (
            <>
              <Row
                label={t('Raum lesen und Änderungen vorschlagen')}
                hint={t('Jede Änderung des Assistenten gilt erst nach deiner Freigabe.')}
              >
                <Toggle
                  label={t('Raum lesen und Änderungen vorschlagen')}
                  checked={detail.ai.enabled}
                  onChange={on => void op('ai.settings', { enabled: on })}
                />
              </Row>
              <Row
                label={t('Cloud-Modelle und externe Agenten erlauben')}
                hint={t('Sonst arbeitet der Assistent für diesen Raum nur mit dem lokalen Modell.')}
              >
                <Toggle
                  label={t('Cloud-Modelle und externe Agenten erlauben')}
                  checked={detail.ai.cloudAllowed}
                  onChange={on => void setCloud(on)}
                />
              </Row>
            </>
          )}
          {chatGrant && (
            <Row
              label={t('Im Chat ohne Rückfrage schreiben')}
              hint={
                t(
                  'Bis auf Widerruf, nur auf diesem Gerät, höchstens 10 Nachrichten in 10 Minuten. Seine Nachrichten sind für alle als „KI-erstellt“ markiert.'
                ) +
                (detail.aiChatGrant
                  ? ' ' + t('Erlaubt seit {date}', { date: fullDateLabel(detail.aiChatGrant.since) })
                  : '')
              }
            >
              <Toggle
                label={t('Im Chat ohne Rückfrage schreiben')}
                checked={Boolean(detail.aiChatGrant)}
                onChange={on =>
                  void run(
                    () => spaces.post(`/${detail.id}/chat/grant`, { on }),
                    on ? t('Erlaubt bis auf Widerruf.') : t('Zurückgenommen.')
                  )
                }
              />
            </Row>
          )}
          {owner && (
            <Row label={t('Hinweise für den Assistenten')} wide>
              <textarea
                value={instructions}
                rows={3}
                maxLength={4000}
                onChange={e => setInstructions(e.target.value)}
                onBlur={saveInstructions}
                placeholder={t('z. B. Ansprechpartner, Tonfall gegenüber dem Kunden')}
              />
            </Row>
          )}
        </Section>
      )}
      <Section
        level={3}
        title={t('Abgleich')}
        description={t('Über {email}. Änderungen kommen in der Regel innerhalb einer Minute bei allen an.', {
          email: detail.email
        })}
      >
        <Row
          label={t('Fehlende Inhalte')}
          hint={t('Fehlt auf diesem Gerät etwas, schicken die anderen Mitglieder es erneut.')}
        >
          <Button
            size="sm"
            onClick={() => void run(() => spaces.post(`/${detail.id}/resync`), t('Fehlende Inhalte werden angefragt.'))}
          >
            <RefreshCcw size={14} /> {t('Fehlendes anfragen')}
          </Button>
        </Row>
      </Section>
      {(active || canDeleteCopy) && (
        <Section level={3} danger title={t('Gefahrenzone')}>
          {owner && others.length > 0 && (
            <Row
              label={t('Raum übergeben')}
              hint={t('Du wirst danach Bearbeiter und kannst nicht mehr einladen oder entfernen.')}
            >
              <div className="settings-actions">
                <select
                  aria-label={t('Neuer Besitzer')}
                  value={transferTo}
                  onChange={e => setTransferTo(e.target.value)}
                >
                  <option value="">{t('Mitglied wählen')}</option>
                  {others.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!transferTo}
                  onClick={async () => {
                    if (
                      await ui.confirm({
                        title: t('Raum übergeben?'),
                        message: t('Du wirst danach Bearbeiter und kannst nicht mehr einladen oder entfernen.'),
                        confirmLabel: t('Übergeben')
                      })
                    )
                      void run(() => spaces.post(`/${detail.id}/transfer`, { member: transferTo }));
                  }}
                >
                  {t('Übergeben')}
                </Button>
              </div>
            </Row>
          )}
          {owner && (
            <Row
              label={t('Raum auflösen')}
              hint={t('Für alle Mitglieder wird der Raum schreibgeschützt. Jeder kann seine Kopie danach löschen.')}
            >
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (
                    await ui.confirm({
                      title: t('Raum auflösen?'),
                      message: t(
                        'Für alle Mitglieder wird der Raum schreibgeschützt. Jeder kann seine Kopie danach löschen.'
                      ),
                      confirmLabel: t('Auflösen'),
                      danger: true
                    })
                  )
                    void run(() => spaces.post(`/${detail.id}/dissolve`, { confirm: true }));
                }}
              >
                {t('Auflösen')}
              </Button>
            </Row>
          )}
          {!detail.owner && active && (
            <Row
              label={t('Raum verlassen')}
              hint={t(
                'Du bekommst danach keine neuen Inhalte mehr. Für einen Wiedereintritt braucht es eine neue Einladung.'
              )}
            >
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (
                    await ui.confirm({
                      title: t('Raum verlassen?'),
                      message: t(
                        'Du bekommst danach keine neuen Inhalte mehr. Für einen Wiedereintritt braucht es eine neue Einladung.'
                      ),
                      confirmLabel: t('Verlassen'),
                      danger: true
                    })
                  )
                    void run(() => spaces.post(`/${detail.id}/leave`));
                }}
              >
                {t('Verlassen')}
              </Button>
            </Row>
          )}
          {canDeleteCopy && (
            <Row
              label={t('Kopie auf diesem Gerät')}
              hint={t('Alle Inhalte dieses Raums werden von diesem Gerät gelöscht.')}
            >
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (
                    await ui.confirm({
                      title: t('Kopie löschen?'),
                      message: t('Alle Inhalte dieses Raums werden von diesem Gerät gelöscht.'),
                      confirmLabel: t('Löschen'),
                      danger: true
                    })
                  )
                    if (await run(() => spaces.post(`/${detail.id}/delete-local`, { confirm: true }))) onGone();
                }}
              >
                <Trash2 size={14} /> {t('Kopie löschen')}
              </Button>
            </Row>
          )}
        </Section>
      )}
    </div>
  );
}
