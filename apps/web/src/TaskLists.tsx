// Connected task lists (CalDAV, later Microsoft To Do and Google Tasks): the list filter in the
// tasks sidebar, "sync now" and the dialog that connects and disconnects lists.
// The list on this device stays the default; nothing is sent before a list is connected.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cloud, HardDrive, Layers, Link2, LoaderCircle, RefreshCw, Unlink } from 'lucide-react';
import { getJson, postJson } from './api';
import { useOAuthSignIn } from './AccountSettings';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, Dialog } from './ui';
import type { TaskLink, TaskListFilter, TaskListSource, TaskSyncProvider } from './tasks';

export const taskListsChanged = () => window.dispatchEvent(new CustomEvent('levuvo:task-lists-changed'));
const tasksChanged = () => window.dispatchEvent(new CustomEvent('levuvo:tasks-changed'));

type SourceError = { accountLabel: string; error: string; code?: string; provider?: string; accountId?: string };
type SyncState = { links: TaskLink[]; busy: boolean; accounts: { id: string; label: string; provider: string }[] };

/** Connected lists; reloads after changes and after each sync. */
export function useTaskLinks() {
  const [state, setState] = useState<SyncState | null>(null);
  const load = useCallback(async () => {
    try {
      setState(await getJson<SyncState>('/api/tasks/sync'));
    } catch {
      setState({ links: [], busy: false, accounts: [] });
    }
  }, []);
  useEffect(() => {
    void load();
    window.addEventListener('levuvo:task-lists-changed', load);
    return () => window.removeEventListener('levuvo:task-lists-changed', load);
  }, [load]);
  return { links: state?.links || [], accounts: state?.accounts || [], loaded: Boolean(state), reload: load };
}

export function useProviderNames() {
  const { t } = useT();
  return (p: TaskSyncProvider) =>
    ({ caldav: t('CalDAV'), microsoft: t('Microsoft To Do'), google: t('Google Tasks') })[p] || p;
}

export function TaskListsNav({
  filter,
  onFilter,
  links,
  counts
}: {
  filter: TaskListFilter;
  onFilter: (f: TaskListFilter) => void;
  links: TaskLink[];
  counts: Record<string, number>;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const errors = links.filter(l => l.lastError);

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await postJson<{ results: Record<string, { conflicts?: { title: string }[]; error?: string }> }>(
        '/api/tasks/sync/run',
        {},
        'mail-v1'
      );
      const results = Object.values(r.results);
      const conflicts = results.reduce((n, x) => n + (x.conflicts?.length || 0), 0);
      const failed = results.filter(x => x.error).length;
      toast(
        failed
          ? { text: t('Abgleich mit Fehlern. Details stehen bei der Liste.'), kind: 'error' }
          : conflicts
            ? {
                text: t('Abgeglichen. {count} gleichzeitige Änderungen: jeweils die neuere wurde übernommen.', {
                  count: String(conflicts)
                }),
                kind: 'info'
              }
            : { text: t('Aufgaben abgeglichen.'), kind: 'success' }
      );
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setSyncing(false);
      tasksChanged();
      taskListsChanged();
    }
  }

  const item = (id: TaskListFilter, label: string, icon: typeof Cloud, extra?: string, warn = false) => {
    const Icon = icon;
    return (
      <button
        key={id}
        className={`folder-item ${filter === id ? 'active' : ''}`}
        onClick={() => onFilter(id)}
        aria-current={filter === id ? 'page' : undefined}
        title={extra}
      >
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{label}</span>
        {warn ? (
          <AlertTriangle size={14} className="task-list-warn" aria-label={t('Fehler beim Abgleich')} />
        ) : (
          (counts[id] || 0) > 0 && <span className="folder-count">{counts[id]}</span>
        )}
      </button>
    );
  };

  return (
    <>
      <h3>{t('Listen')}</h3>
      {links.length > 0 && item('all', t('Alle Listen'), Layers)}
      {item('local', t('Auf diesem Gerät'), HardDrive)}
      {links.map(l => item(l.id, l.name, Cloud, l.lastError ? t(l.lastError) : l.accountLabel, Boolean(l.lastError)))}
      {errors.map(l => (
        <p key={l.id} className="task-list-error" role="status">
          {l.name}: {t(l.lastError || '')}
        </p>
      ))}
      <div className="task-list-actions">
        <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => setConnecting(true)}>
          {t('Liste verbinden')}
        </Button>
        {links.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            busy={syncing}
            icon={<RefreshCw size={14} className={syncing ? 'spin' : ''} />}
            onClick={() => void syncNow()}
          >
            {t('Jetzt abgleichen')}
          </Button>
        )}
      </div>
      {connecting && <ConnectListDialog links={links} onClose={() => setConnecting(false)} />}
    </>
  );
}

export function ConnectListDialog({ links, onClose }: { links: TaskLink[]; onClose: () => void }) {
  const { t } = useT();
  const { toast, confirm } = useUi();
  const providerName = useProviderNames();
  const [sources, setSources] = useState<TaskListSource[] | null>(null);
  const [errors, setErrors] = useState<SourceError[]>([]);
  const [moveLocal, setMoveLocal] = useState(false);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await getJson<{ lists: TaskListSource[]; errors: SourceError[] }>('/api/tasks/sync/sources');
      setSources(r.lists || []);
      setErrors(r.errors || []);
    } catch (e) {
      setSources([]);
      setErrors([{ accountLabel: '', error: (e as Error).message }]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // Microsoft 365 / Google accounts signed in before need a one-time consent for their tasks.
  const oauth = useOAuthSignIn(load);

  async function connect(s: TaskListSource) {
    setBusy(s.listId);
    try {
      const r = await postJson<{ link: TaskLink; result: { created?: number; error?: string } }>(
        '/api/tasks/sync/link',
        { provider: s.provider, accountId: s.accountId, listId: s.listId, moveLocal },
        'mail-v1'
      );
      if (r.result?.error) toast({ text: r.result.error, kind: 'error' });
      else
        toast({
          text: t('„{name}“ ist verbunden. {count} Aufgaben übernommen.', {
            name: s.name,
            count: String(r.result?.created || 0)
          }),
          kind: 'success'
        });
      tasksChanged();
      taskListsChanged();
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  }
  async function disconnect(link: TaskLink) {
    const ok = await confirm({
      title: t('Liste trennen?'),
      message: t(
        'Die Aufgaben aus „{name}“ bleiben auf diesem Gerät. Auf dem Server wird nichts gelöscht, es wird nur nicht mehr abgeglichen.',
        { name: link.name }
      ),
      confirmLabel: t('Trennen')
    });
    if (!ok) return;
    try {
      await postJson('/api/tasks/sync/unlink', { id: link.id }, 'mail-v1');
      tasksChanged();
      taskListsChanged();
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  const linkOf = (s: TaskListSource) =>
    links.find(l => l.provider === s.provider && l.accountId === s.accountId && l.listId === s.listId);
  return (
    <Dialog
      title={t('Aufgabenliste verbinden')}
      description={t(
        'Abgeglichen werden Titel, Notiz, Fälligkeit, Erinnerung, Priorität, Wiederholung und der Status. Der Link zur E-Mail bleibt auf diesem Gerät.'
      )}
      onClose={onClose}
      size="md"
      footer={<Button onClick={onClose}>{t('Fertig')}</Button>}
    >
      {!sources ? (
        <div className="empty-list">
          <LoaderCircle className="spin" size={20} />
        </div>
      ) : (
        <>
          {sources.length === 0 && !errors.length && (
            <p className="task-sync-empty">
              {t(
                'Keine Aufgabenlisten gefunden. Aufgabenlisten kommen von CalDAV-Konten (z. B. Nextcloud, unter Einstellungen › Kalender & Kontakte) und von Microsoft-365- oder Google-Konten, die mit dem Anbieter angemeldet sind.'
              )}
            </p>
          )}
          {errors.map((e, i) => (
            <p key={i} className="task-list-error" role="alert">
              {e.accountLabel ? `${e.accountLabel}: ` : ''}
              {t(e.error)}
              {e.code === 'tasks_consent_required' && e.provider && e.accountId && (
                <Button
                  size="sm"
                  variant="primary"
                  className="task-consent"
                  busy={oauth.busy}
                  onClick={() => void oauth.start(e.provider!, e.accountId)}
                >
                  {oauth.busy ? t('Warte auf Freigabe …') : t('Freigeben')}
                </Button>
              )}
            </p>
          ))}
          {oauth.error && (
            <p className="task-list-error" role="alert">
              {oauth.error}
            </p>
          )}
          {sources.length > 0 && (
            <ul className="task-sources" aria-label={t('Aufgabenlisten')}>
              {sources.map(s => {
                const link = linkOf(s);
                return (
                  <li key={`${s.provider}|${s.accountId}|${s.listId}`} className="task-source">
                    <Cloud size={16} aria-hidden="true" />
                    <span className="task-source-name">
                      <strong>{s.name}</strong>
                      <small>
                        {providerName(s.provider)} · {s.accountLabel}
                      </small>
                    </span>
                    {link ? (
                      <Button size="sm" icon={<Unlink size={14} />} onClick={() => void disconnect(link)}>
                        {t('Trennen')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        busy={busy === s.listId}
                        disabled={Boolean(busy)}
                        onClick={() => void connect(s)}
                      >
                        {t('Verbinden')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {sources.some(s => !linkOf(s)) && (
            <label className="task-option">
              <input type="checkbox" checked={moveLocal} onChange={e => setMoveLocal(e.target.checked)} />
              <span>{t('Offene Aufgaben dieses Geräts in die verbundene Liste übernehmen')}</span>
            </label>
          )}
        </>
      )}
    </Dialog>
  );
}
