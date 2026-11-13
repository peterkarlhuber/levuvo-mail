import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, CircleHelp, Command, Contact2, LoaderCircle, Mail, RefreshCcw, Settings2 } from 'lucide-react';
import AccountSettings from './AccountSettings';
import { ConfirmProvider, useUi } from './ConfirmDialog';
import type { ComposeInitial, OutgoingPayload } from './Composer';
import MailInstance from './MailInstance';
import CommandPalette from './CommandPalette';
import { ApiError, getJson, postJson } from './api';
import { setFormatLocale } from './format';
import { useT } from './i18n';
import { accountMarkerKey, detectArrivals, type NotificationCursor } from './notification-tracker';
import { useDocumentPrefs, usePrefs } from './prefs';
import type { AccountItem, InboxMonitorResult, InboxSnapshot, Runtime } from './types';

const CalendarModule = lazy(() => import('./Calendar'));
const ContactsModule = lazy(() => import('./Contacts'));
const SettingsModule = lazy(() => import('./Settings'));

type NotificationState = NotificationPermission | 'unsupported';
export type Module = 'mail' | 'calendar' | 'contacts' | 'settings';
export type SettingsTab =
  | 'general'
  | 'accounts'
  | 'templates'
  | 'filters'
  | 'dav'
  | 'security'
  | 'search'
  | 'notifications'
  | 'privacy'
  | 'help'
  | 'about';
const POLL_MS = 20_000;
const CURSOR_PREFIX = 'levuvo-mail-notification-v072:';

const notificationState = (): NotificationState =>
  typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';

function readCursor(key: string): NotificationCursor | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`${CURSOR_PREFIX}${key}`) || 'null');
    if (value && typeof value === 'object' && 'accountKey' in value && value.accountKey === key)
      return value as NotificationCursor;
  } catch {
    /* storage blocked */
  }
  return null;
}
function writeCursor(key: string, cursor: NotificationCursor) {
  try {
    window.localStorage.setItem(`${CURSOR_PREFIX}${key}`, JSON.stringify(cursor));
  } catch {
    /* storage blocked */
  }
}

/** Reports unexpected UI errors (code only, no content) when the user opted in. */
function useErrorReporting() {
  useEffect(() => {
    const report = (code: string) => {
      void postJson('/api/diagnostics/client-error', { code }, 'mail-v1').catch(() => {});
    };
    const onError = (e: ErrorEvent) => report(`ui.${(e.error?.name || 'error').slice(0, 40)}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      if (!(e.reason instanceof ApiError)) report(`ui.rejection.${(e.reason?.name || 'error').slice(0, 30)}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
}

function Shell() {
  useDocumentPrefs();
  useErrorReporting();
  const { t, locale } = useT();
  const { toast, updateToast, dismiss } = useUi();
  const [prefs] = usePrefs();
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [credentialsMissing, setCredentialsMissing] = useState(false);
  const [active, setActive] = useState<{ id: string; openUid: number | null; openFolder?: string }>({
    id: 'primary',
    openUid: null
  });
  const [module, setModule] = useState<Module>('mail');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const [snapshots, setSnapshots] = useState<Record<string, InboxSnapshot>>({});
  const [pollState, setPollState] = useState<Record<string, { checkedAt: number | null; error?: string }>>({});
  const [notify, setNotify] = useState<NotificationState>(notificationState);
  const [pendingCompose, setPendingCompose] = useState<{
    accountId: string;
    initial: ComposeInitial;
    nonce: number;
  } | null>(null);
  const activeRef = useRef(active.id);
  activeRef.current = active.id;
  const memoryCursors = useRef<Record<string, NotificationCursor>>({});
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    setFormatLocale(locale);
    document.documentElement.lang = locale.slice(0, 2);
  }, [locale]);
  useEffect(() => {
    getJson<Runtime>('/api/runtime')
      .then(setRuntime)
      .catch(() => setRuntime({ desktop: false, version: '' }));
  }, []);

  const reloadAccounts = useCallback(async () => {
    try {
      const data = await getJson<{ accounts: AccountItem[] }>('/api/accounts');
      const configured = data.accounts.filter(a => a.configured);
      setCredentialsMissing(data.accounts.length > 0 && configured.length === 0);
      setAccounts(configured);
      setActive(current =>
        configured.some(a => a.id === current.id) ? current : { id: configured[0]?.id || 'primary', openUid: null }
      );
      setAccountsError('');
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : t('Konten konnten nicht geladen werden.'));
    } finally {
      setLoaded(true);
    }
  }, [t]);
  useEffect(() => {
    void reloadAccounts();
  }, [reloadAccounts]);

  const requestNotifications = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotify('unsupported');
      return;
    }
    try {
      setNotify(await Notification.requestPermission());
    } catch {
      setNotify(notificationState());
    }
  }, []);

  // Inbox state for every account (served from the IMAP IDLE cache). In the browser
  // (dev mode) this also drives notifications; in the desktop app the main process does.
  useEffect(() => {
    if (!accounts.length || runtime === null) return;
    let cancelled = false;
    let running = false;
    const poll = async (fresh = false) => {
      if (cancelled || running) return;
      running = true;
      try {
        await Promise.all(
          accounts.map(async account => {
            try {
              const state = await getJson<InboxMonitorResult>(
                `/api/inbox/monitor${fresh ? '?fresh=1' : ''}`,
                account.id
              );
              if (cancelled) return;
              const checkedAt = state.checkedAt || Date.now();
              if (!runtime.desktop) {
                const key = accountMarkerKey(account.id, account.mailbox);
                const result = detectArrivals(
                  key,
                  state,
                  readCursor(key) || memoryCursors.current[key] || null,
                  checkedAt
                );
                memoryCursors.current[key] = result.next;
                writeCursor(key, result.next);
                if (result.newCount > 0 && 'Notification' in window && Notification.permission === 'granted') {
                  try {
                    new Notification(`Levuvo Mail · ${account.label}`, {
                      body: t('{count} neue Nachricht(en) im Posteingang.', { count: result.newCount }),
                      icon: '/favicon.png',
                      tag: `levuvo-inbox-${account.id}-${state.highestUid}`
                    });
                  } catch {
                    /* blocked by the OS */
                  }
                }
              }
              setSnapshots(old =>
                old[account.id]?.checkedAt === checkedAt
                  ? old
                  : { ...old, [account.id]: { messages: state.messages, checkedAt, unseen: state.unseen ?? null } }
              );
              setPollState(old => ({ ...old, [account.id]: { checkedAt } }));
            } catch (error) {
              if (!cancelled)
                setPollState(old => ({
                  ...old,
                  [account.id]: { checkedAt: old[account.id]?.checkedAt ?? null, error: (error as Error).message }
                }));
            }
          })
        );
      } finally {
        running = false;
      }
    };
    pollNow.current = () => void poll(true);
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [accounts, runtime, t]);

  // Calendar reminders in the browser (the desktop app shows them from the main process).
  useEffect(() => {
    if (!runtime || runtime.desktop) return;
    const shown = new Set<string>();
    const check = async () => {
      const now = Date.now();
      try {
        const { alarms } = await getJson<{
          alarms: { key: string; at: number; title: string; start: string; allDay: boolean; location: string }[];
        }>(
          `/api/calendar/alarms?from=${new Date(now - 60_000).toISOString()}&to=${new Date(now + 60_000).toISOString()}`
        );
        for (const a of alarms) {
          if (shown.has(a.key) || a.at > now) continue;
          shown.add(a.key);
          const when = a.allDay
            ? t('ganztägig')
            : new Date(a.start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
          toast({
            text: `${a.title} · ${when}${a.location ? ` · ${a.location}` : ''}`,
            kind: 'info',
            timeout: 15000,
            action: { label: t('Kalender'), run: () => setModule('calendar') }
          });
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(a.title, { body: when, icon: '/favicon.png' });
            } catch {
              /* blocked */
            }
          }
        }
      } catch {
        /* no calendar account */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(timer);
  }, [runtime, t, locale, toast]);

  // Follow-ups in the browser (the desktop app notifies from the main process).
  useEffect(() => {
    if (!runtime || runtime.desktop) return;
    const seen = new Set<string>();
    const check = async () => {
      try {
        const { items } = await getJson<{ items: { id: string; state: string; subject: string }[] }>('/api/followups');
        for (const f of items) {
          if (f.state !== 'due' || seen.has(f.id)) continue;
          seen.add(f.id);
          toast({ text: t('Keine Antwort erhalten: {subject}', { subject: f.subject }), kind: 'info', timeout: 12000 });
        }
      } catch {
        /* offline */
      }
    };
    const timer = window.setInterval(() => void check(), 60_000);
    void check();
    return () => window.clearInterval(timer);
  }, [runtime, t, toast]);

  // Desktop: deep links from notifications ("open message", "open calendar").
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const d =
        (e as CustomEvent<{ module?: Module; accountId?: string; uid?: number; folder?: string; compose?: boolean }>)
          .detail || {};
      if (d.module) setModule(d.module);
      if (d.accountId) setActive({ id: d.accountId, openUid: d.uid ?? null, openFolder: d.folder });
      if (d.compose)
        setPendingCompose({
          accountId: d.accountId || activeRef.current,
          initial: { mode: 'new', to: '', cc: '', bcc: '', subject: '' },
          nonce: Date.now()
        });
    };
    window.addEventListener('levuvo:navigate', onNavigate);
    return () => window.removeEventListener('levuvo:navigate', onNavigate);
  }, []);

  // ------------------------------------------------------------------ outbox (undo send / schedule)
  const pendingSends = useRef(0);
  const restore = useCallback((accountId: string, initial: ComposeInitial) => {
    setModule('mail');
    setActive(a => (a.id === accountId ? a : { id: accountId, openUid: null }));
    setPendingCompose({ accountId, initial, nonce: Date.now() });
  }, []);

  const submitCompose = useCallback(
    (accountId: string, payload: OutgoingPayload, initial: ComposeInitial, sendAt: string | null) => {
      const requestId = crypto.randomUUID();
      const notifyChanged = () =>
        window.dispatchEvent(new CustomEvent('levuvo:mail-changed', { detail: { accountId } }));
      if (sendAt) {
        const id = toast({ text: t('Wird geplant …'), timeout: 0 });
        postJson<{ sendAt: string }>(
          '/api/messages/schedule',
          { ...payload, requestId, confirm: 'SEND', sendAt },
          'send-v1',
          accountId
        )
          .then(r => {
            dismiss(id);
            toast({
              text: t('Geplant für {when}. Zu finden unter „Entwürfe“.', {
                when: new Date(r.sendAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
              }),
              kind: 'success'
            });
            notifyChanged();
          })
          .catch((err: Error) => {
            dismiss(id);
            toast({
              text: err.message,
              kind: 'error',
              timeout: 0,
              action: { label: t('Bearbeiten'), run: () => restore(accountId, initial) }
            });
          });
        return;
      }
      const send = (toastId: number | null) => {
        if (toastId !== null)
          updateToast(toastId, { text: t('Wird gesendet …'), action: undefined, progress: undefined });
        const id = toastId ?? toast({ text: t('Wird gesendet …'), timeout: 0 });
        pendingSends.current++;
        postJson<{
          acceptedCount: number;
          rejectedCount: number;
          savedToSent: boolean;
          sentCopyError?: string;
          partial: boolean;
        }>('/api/messages/send', { ...payload, requestId, confirm: 'SEND' }, 'send-v1', accountId)
          .then(r => {
            dismiss(id);
            if (r.partial)
              toast({
                text: t('Teilweise gesendet: {ok} angenommen, {bad} abgelehnt.', {
                  ok: r.acceptedCount,
                  bad: r.rejectedCount
                }),
                kind: 'error',
                timeout: 0
              });
            else
              toast({
                text: r.savedToSent
                  ? t('Nachricht gesendet.')
                  : t('Gesendet, aber nicht im Ordner „Gesendet“ abgelegt.'),
                kind: r.savedToSent ? 'success' : 'info'
              });
            notifyChanged();
          })
          .catch((err: Error) => {
            dismiss(id);
            toast({
              text: err.message,
              kind: 'error',
              timeout: 0,
              action:
                err instanceof ApiError && err.status < 500
                  ? { label: t('Bearbeiten'), run: () => restore(accountId, initial) }
                  : undefined
            });
          })
          .finally(() => {
            pendingSends.current--;
          });
      };
      const delay = prefs.sendDelay;
      if (!delay) {
        send(null);
        return;
      }
      let cancelled = false;
      const started = Date.now();
      const id = toast({
        text: t('Wird in {seconds} s gesendet', { seconds: delay }),
        timeout: 0,
        progress: 100,
        action: {
          label: t('Rückgängig'),
          run: () => {
            cancelled = true;
            window.clearInterval(tick);
            restore(accountId, initial);
          }
        }
      });
      const tick = window.setInterval(() => {
        if (cancelled) return;
        const left = delay * 1000 - (Date.now() - started);
        if (left <= 0) {
          window.clearInterval(tick);
          send(id);
          return;
        }
        updateToast(id, {
          text: t('Wird in {seconds} s gesendet', { seconds: Math.ceil(left / 1000) }),
          progress: (left / (delay * 1000)) * 100
        });
      }, 200);
    },
    [prefs.sendDelay, toast, updateToast, dismiss, t, locale, restore]
  );

  const selectAccountFromPalette = useCallback((id: string) => setActive({ id, openUid: null }), []);
  const openSettings = useCallback((tab: SettingsTab = 'general') => {
    setSettingsTab(tab);
    setModule('settings');
  }, []);
  const composeTo = useCallback(
    (to: string) => {
      restore(active.id, { mode: 'new', to, cc: '', bcc: '', subject: '' });
    },
    [active.id, restore]
  );

  if (!loaded || runtime === null)
    return (
      <div className="onboarding-shell">
        <p className="onboarding-loading">
          <LoaderCircle className="spin" size={16} /> {t('Levuvo Mail startet …')}
        </p>
      </div>
    );
  if (accountsError) {
    return (
      <div className="onboarding-shell">
        <div className="onboarding-panel">
          <h1>
            {t('Verbindung unterbrochen')}
            <span className="period">.</span>
          </h1>
          <p role="alert">{accountsError}</p>
          <button className="btn primary" onClick={() => void reloadAccounts()}>
            {t('Erneut versuchen')} <RefreshCcw size={16} />
          </button>
        </div>
      </div>
    );
  }
  if (!accounts.length) {
    return (
      <div className="onboarding-shell">
        <div className="onboarding-panel">
          <img src="/levuvo-header-logo.png" alt="Levuvo" className="onboarding-logo brand-image" />
          <h1>
            {credentialsMissing ? (
              t('Zugang prüfen')
            ) : (
              <>
                {t('Willkommen bei')}
                <br />
                Levuvo Mail
              </>
            )}
            <span className="period">.</span>
          </h1>
          <p>
            {credentialsMissing
              ? t(
                  'Deine Konten sind eingerichtet, die Passwörter im Schlüsselbund sind aber gerade nicht verfügbar. Bitte den Schlüsselbund entsperren oder das Passwort neu eingeben. Es wurde nichts gelöscht.'
                )
              : t(
                  'Verbinde dein erstes Postfach. Die Verbindung wird vor dem Speichern geprüft, das Passwort landet sicher im Schlüsselbund deines Betriebssystems.'
                )}
          </p>
          {credentialsMissing && (
            <button className="btn onboarding-retry" onClick={() => void reloadAccounts()}>
              <RefreshCcw size={15} /> {t('Erneut prüfen')}
            </button>
          )}
          <AccountSettings onChanged={reloadAccounts} onboarding={!credentialsMissing} />
          <p className="onboarding-motto">Less effort. More impact.</p>
        </div>
      </div>
    );
  }

  const rail: { id: Module; label: string; icon: typeof Mail; key: string }[] = [
    { id: 'mail', label: t('E-Mail'), icon: Mail, key: '1' },
    { id: 'calendar', label: t('Kalender'), icon: CalendarDays, key: '2' },
    { id: 'contacts', label: t('Kontakte'), icon: Contact2, key: '3' }
  ];
  const unseenTotal = Object.values(snapshots).reduce((n, s) => n + (s.unseen || 0), 0);
  const fallback = (
    <div className="module-loading">
      <LoaderCircle className="spin" size={18} />
    </div>
  );

  return (
    <div className={`app-frame density-${prefs.density}`}>
      <nav className="rail" aria-label={t('Bereiche')}>
        <span className="rail-logo" title="Levuvo Mail">
          <img src="/favicon.png" alt="Levuvo" />
        </span>
        {rail.map(item => (
          <button
            key={item.id}
            className={`rail-item ${module === item.id ? 'active' : ''}`}
            onClick={() => setModule(item.id)}
            title={`${item.label} (Alt+${item.key})`}
            aria-label={item.label}
            aria-current={module === item.id ? 'page' : undefined}
          >
            <item.icon size={20} strokeWidth={1.8} />
            {item.id === 'mail' && unseenTotal > 0 && (
              <span className="rail-badge">{unseenTotal > 99 ? '99+' : unseenTotal}</span>
            )}
            <span className="rail-label">{item.label}</span>
          </button>
        ))}
        <span className="rail-spacer" />
        <button
          className="rail-item"
          onClick={() => window.dispatchEvent(new Event('levuvo:palette'))}
          title={t('Befehle (Strg/⌘+K)')}
          aria-label={t('Befehle')}
        >
          <Command size={19} strokeWidth={1.8} />
        </button>
        <button
          className={`rail-item ${module === 'settings' && settingsTab === 'help' ? 'active' : ''}`}
          onClick={() => openSettings('help')}
          title={t('Hilfe')}
          aria-label={t('Hilfe')}
        >
          <CircleHelp size={20} strokeWidth={1.8} />
        </button>
        <button
          className={`rail-item ${module === 'settings' && settingsTab !== 'help' ? 'active' : ''}`}
          onClick={() => openSettings('general')}
          title={t('Einstellungen')}
          aria-label={t('Einstellungen')}
        >
          <Settings2 size={20} strokeWidth={1.8} />
        </button>
      </nav>
      <div className="module-host">
        <div className="module" hidden={module !== 'mail'}>
          <MailInstance
            key={`${active.id}:${active.openUid ?? ''}:${active.openFolder ?? ''}`}
            accountId={active.id}
            accounts={accounts}
            visible={module === 'mail'}
            inboxSnapshot={snapshots[active.id]}
            pollState={pollState}
            initialOpen={active.openUid !== null ? { uid: active.openUid, folder: active.openFolder || null } : null}
            pendingCompose={pendingCompose?.accountId === active.id ? pendingCompose : null}
            onPendingComposeTaken={() => setPendingCompose(null)}
            onSelectAccount={(id, open) =>
              setActive({ id, openUid: open?.uid ?? null, openFolder: open?.folder || undefined })
            }
            onSubmitCompose={submitCompose}
            onOpenSettings={openSettings}
          />
        </div>
        {module === 'calendar' && (
          <Suspense fallback={fallback}>
            <CalendarModule accounts={accounts} onOpenSettings={() => openSettings('dav')} />
          </Suspense>
        )}
        {module === 'contacts' && (
          <Suspense fallback={fallback}>
            <ContactsModule
              onCompose={to => {
                composeTo(to);
              }}
              onOpenSettings={() => openSettings('dav')}
            />
          </Suspense>
        )}
        {module === 'settings' && (
          <Suspense fallback={fallback}>
            <SettingsModule
              tab={settingsTab}
              onTab={setSettingsTab}
              runtime={runtime}
              accounts={accounts}
              pollState={pollState}
              notificationState={notify}
              onRequestNotifications={() => void requestNotifications()}
              onAccountsChanged={reloadAccounts}
              onCheckNow={() => pollNow.current()}
              onClose={() => setModule('mail')}
            />
          </Suspense>
        )}
      </div>
      <ModuleShortcuts onModule={setModule} />
      <CommandPalette
        accounts={accounts}
        activeAccountId={active.id}
        onModule={setModule}
        onSettings={openSettings}
        onAccount={selectAccountFromPalette}
      />
    </div>
  );
}

function ModuleShortcuts({ onModule }: { onModule: (m: Module) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const map: Record<string, Module> = { '1': 'mail', '2': 'calendar', '3': 'contacts', ',': 'settings' };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        onModule(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onModule]);
  return null;
}

export default function App() {
  return (
    <ConfirmProvider>
      <Shell />
    </ConfirmProvider>
  );
}
