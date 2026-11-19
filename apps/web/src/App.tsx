import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CircleHelp,
  Command,
  Contact2,
  ListTodo,
  LoaderCircle,
  Mail,
  RefreshCcw,
  Settings2,
  Sparkles,
  Users
} from 'lucide-react';
import AccountSettings from './AccountSettings';
import { ConfirmProvider, useUi } from './ConfirmDialog';
import type { ComposeInitial, OutgoingPayload } from './Composer';
import MailInstance from './MailInstance';
import CommandPalette from './CommandPalette';
import { AssistantPanel, usePendingApprovals } from './AssistantPanel';
import { Briefing, lastBriefingDay, markBriefingShown, type BriefingTarget } from './Briefing';
import { sendMailCommand } from './command-bus';
import { localDay, shouldAutoOpen } from './day-utils';
import { MeetingPrep } from './MeetingPrep';
import { useBundleAssist } from './BundleAssist';
import { ApiError, getJson, postJson } from './api';
import { setFormatLocale } from './format';
import { useT } from './i18n';
import { accountMarkerKey, detectArrivals, type NotificationCursor } from './notification-tracker';
import { useDocumentPrefs, usePrefs } from './prefs';
import { useTaskBadge } from './task-reminders';
import { useSpacesChatBadge } from './spaces-badge';
import { lazyModule, ModuleBoundary } from './ModuleBoundary';
import type { AccountItem, InboxMonitorResult, InboxSnapshot, Runtime } from './types';

// Lazy modules reload the page once when their chunk is gone (app updated while it ran).
const CalendarModule = lazyModule(() => import('./Calendar'));
const ContactsModule = lazyModule(() => import('./Contacts'));
const TasksModule = lazyModule(() => import('./TasksModule'));
const SettingsModule = lazyModule(() => import('./Settings'));
const RestoreOnWelcome = lazyModule(() =>
  import('./SettingsBackup').then(m => ({ default: () => <m.BackupSettings restoreOnly /> }))
);
const SpacesModule = lazyModule(() => import('./Spaces'));

type NotificationState = NotificationPermission | 'unsupported';
export type Module = 'mail' | 'calendar' | 'contacts' | 'spaces' | 'tasks' | 'settings';
export type SettingsTab =
  | 'general'
  | 'accounts'
  | 'templates'
  | 'filters'
  | 'automations'
  | 'booking'
  | 'dav'
  | 'security'
  | 'search'
  | 'ai'
  | 'notifications'
  | 'privacy'
  | 'backup'
  | 'help'
  | 'about';
// Served from the IMAP IDLE cache on localhost, so a short interval is cheap and keeps "Live" honest.
const POLL_MS = 5_000;
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
  useBundleAssist();
  const { t, locale } = useT();
  const { toast, updateToast, dismiss } = useUi();
  const [prefs] = usePrefs();
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [credentialsMissing, setCredentialsMissing] = useState(false);
  const [restoreOnWelcome, setRestoreOnWelcome] = useState(false);
  const [active, setActive] = useState<{ id: string; openUid: number | null; openFolder?: string }>({
    id: 'primary',
    openUid: null
  });
  const [module, setModule] = useState<Module>('mail');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState<false | 'auto' | 'manual'>(false);
  const [pendingApprovals, setPendingApprovals] = usePendingApprovals();
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

  // "Mein Tag": once a day by itself (when switched on), any time from the palette or the assistant.
  useEffect(() => {
    const today = localDay().key;
    if (
      shouldAutoOpen({
        enabled: prefs.briefingOnStart,
        lastShown: lastBriefingDay(),
        today,
        ready: loaded && accounts.length > 0
      })
    ) {
      markBriefingShown(today);
      setBriefingOpen('auto');
    }
  }, [loaded, accounts.length, prefs.briefingOnStart]);
  useEffect(() => {
    const onOpen = () => {
      markBriefingShown(localDay().key);
      setBriefingOpen('manual');
    };
    window.addEventListener('levuvo:briefing', onOpen);
    return () => window.removeEventListener('levuvo:briefing', onOpen);
  }, []);
  const closeBriefing = useCallback(() => setBriefingOpen(false), []);
  const openFromBriefing = useCallback((target: BriefingTarget) => {
    if (target.type === 'mail') {
      setActive({ id: target.accountId, openUid: target.uid, openFolder: target.folder });
      setModule('mail');
    } else if (target.type === 'followups') {
      setModule('mail');
      window.setTimeout(() => sendMailCommand({ type: 'followups' }), 0);
    } else setModule(target.type);
  }, []);

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
    // A fresh poll requested while another poll runs: that poll may predate a local change,
    // so the fresh one runs right after it instead of being dropped.
    let freshPending = false;
    const poll = async (fresh = false): Promise<void> => {
      if (cancelled) return;
      if (running) {
        if (fresh) freshPending = true;
        return;
      }
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
      if (freshPending && !cancelled) {
        freshPending = false;
        await poll(true);
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

  // Tasks: badge in the rail; reminders in the browser (the desktop app notifies natively).
  const onTaskReminder = useCallback(
    (task: { title: string; notes: string }) => {
      toast({
        text: `${t('Erinnerung')}: ${task.title}`,
        kind: 'info',
        timeout: 15000,
        action: { label: t('Aufgaben'), run: () => setModule('tasks') }
      });
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(task.title, { body: task.notes.slice(0, 120), icon: '/favicon.png' });
        } catch {
          /* blocked */
        }
      }
    },
    [t, toast]
  );
  const chatUnread = useSpacesChatBadge();
  const tasksDue = useTaskBadge({ browserReminders: Boolean(runtime && !runtime.desktop), onReminder: onTaskReminder });

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
  // A manual section linked from the assistant's answer opens the help page.
  useEffect(() => {
    const open = () => openSettings('help');
    window.addEventListener('levuvo:manual', open);
    return () => window.removeEventListener('levuvo:manual', open);
  }, [openSettings]);
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
          <img src="/levuvo-header-logo.png" alt="Levuvo Mail" className="onboarding-logo brand-image" />
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
          {restoreOnWelcome ? (
            <Suspense fallback={<LoaderCircle className="spin" size={16} />}>
              <RestoreOnWelcome />
            </Suspense>
          ) : (
            <AccountSettings onChanged={reloadAccounts} onboarding={!credentialsMissing} />
          )}
          {!credentialsMissing && (
            <button className="link-button onboarding-restore" onClick={() => setRestoreOnWelcome(v => !v)}>
              {restoreOnWelcome
                ? t('Zurück zur Einrichtung')
                : t('Umzug von einem anderen Rechner? Sicherung wiederherstellen')}
            </button>
          )}
          <p className="onboarding-motto">Less effort. More impact.</p>
        </div>
      </div>
    );
  }

  const rail: { id: Module; label: string; icon: typeof Mail; key: string }[] = [
    { id: 'mail', label: t('E-Mail'), icon: Mail, key: '1' },
    { id: 'calendar', label: t('Kalender'), icon: CalendarDays, key: '2' },
    { id: 'contacts', label: t('Kontakte'), icon: Contact2, key: '3' },
    { id: 'spaces', label: t('Räume'), icon: Users, key: '4' },
    { id: 'tasks', label: t('Aufgaben'), icon: ListTodo, key: '5' }
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
          <img src="/favicon.png" alt="Levuvo Mail" />
        </span>
        {rail.map(item => (
          <button
            key={item.id}
            className={`rail-item ${module === item.id ? 'active' : ''}`}
            onClick={() => setModule(item.id)}
            title={`${item.label} (Alt+${item.key})`}
            aria-current={module === item.id ? 'page' : undefined}
          >
            <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
            {item.id === 'mail' && unseenTotal > 0 && (
              <span className="rail-badge" aria-hidden="true">
                {unseenTotal > 99 ? '99+' : unseenTotal}
              </span>
            )}
            {item.id === 'spaces' && chatUnread > 0 && (
              <span className="rail-badge" aria-hidden="true">
                {chatUnread > 99 ? '99+' : chatUnread}
              </span>
            )}
            {item.id === 'tasks' && tasksDue > 0 && (
              <span className="rail-badge" aria-hidden="true">
                {tasksDue > 99 ? '99+' : tasksDue}
              </span>
            )}
            <span className="rail-label">{item.label}</span>
            {item.id === 'mail' && unseenTotal > 0 && (
              <span className="sr-only">, {t('{n} ungelesen', { n: unseenTotal })}</span>
            )}
            {item.id === 'spaces' && chatUnread > 0 && (
              <span className="sr-only">, {t('{n} ungelesene Chat-Nachrichten', { n: chatUnread })}</span>
            )}
            {item.id === 'tasks' && tasksDue > 0 && (
              <span className="sr-only">, {t('{n} heute fällig', { n: tasksDue })}</span>
            )}
          </button>
        ))}
        <span className="rail-spacer" />
        <button
          className={`rail-item ${assistantOpen ? 'active' : ''}`}
          onClick={() => setAssistantOpen(o => !o)}
          title={t('Levuvo Mail Assistant (Strg/⌘+J)')}
          aria-label={
            pendingApprovals > 0 ? t('Assistent, {n} Freigaben offen', { n: pendingApprovals }) : t('Assistent')
          }
          aria-expanded={assistantOpen}
        >
          <Sparkles size={19} strokeWidth={1.8} aria-hidden="true" />
          {pendingApprovals > 0 && (
            <span className="rail-badge" aria-hidden="true">
              {pendingApprovals > 99 ? '99+' : pendingApprovals}
            </span>
          )}
          <span className="rail-label rail-mobile-only">{t('Assistent')}</span>
        </button>
        <button
          className="rail-item rail-desktop-only"
          onClick={() => window.dispatchEvent(new Event('levuvo:palette'))}
          title={t('Befehle (Strg/⌘+K)')}
          aria-label={t('Befehle')}
        >
          <Command size={19} strokeWidth={1.8} />
        </button>
        <button
          className={`rail-item rail-desktop-only ${module === 'settings' && settingsTab === 'help' ? 'active' : ''}`}
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
          <span className="rail-label rail-mobile-only">{t('Einstellungen')}</span>
        </button>
      </nav>
      <div className="module-host">
        <div className="module" hidden={module !== 'mail'}>
          <ModuleBoundary name="mail">
            <MailInstance
              key={`${active.id}:${active.openUid ?? ''}:${active.openFolder ?? ''}`}
              accountId={active.id}
              accounts={accounts}
              visible={module === 'mail'}
              inboxSnapshot={snapshots[active.id]}
              onLocalChange={() => pollNow.current()}
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
          </ModuleBoundary>
        </div>
        {module === 'calendar' && (
          <ModuleBoundary name="calendar">
            <Suspense fallback={fallback}>
              <CalendarModule accounts={accounts} onOpenSettings={() => openSettings('dav')} />
            </Suspense>
          </ModuleBoundary>
        )}
        {module === 'contacts' && (
          <ModuleBoundary name="contacts">
            <Suspense fallback={fallback}>
              <ContactsModule
                onCompose={to => {
                  composeTo(to);
                }}
                onOpenSettings={() => openSettings('dav')}
              />
            </Suspense>
          </ModuleBoundary>
        )}
        {module === 'spaces' && (
          <ModuleBoundary name="spaces">
            <Suspense fallback={fallback}>
              <SpacesModule accounts={accounts} />
            </Suspense>
          </ModuleBoundary>
        )}
        {module === 'tasks' && (
          <ModuleBoundary name="tasks">
            <Suspense fallback={fallback}>
              <TasksModule
                onOpenMail={mail => {
                  setActive({ id: mail.accountId, openUid: mail.uid, openFolder: mail.folder });
                  setModule('mail');
                }}
              />
            </Suspense>
          </ModuleBoundary>
        )}
        {module === 'settings' && (
          <ModuleBoundary name="settings">
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
          </ModuleBoundary>
        )}
      </div>
      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        onOpenMessage={m => {
          setModule('mail');
          setActive({ id: m.accountId, openUid: m.uid, openFolder: m.folder });
        }}
        onOpenSettings={() => {
          setAssistantOpen(false);
          openSettings('ai');
        }}
        onPending={setPendingApprovals}
      />
      {briefingOpen && (
        <Briefing key={briefingOpen} auto={briefingOpen === 'auto'} onClose={closeBriefing} onOpen={openFromBriefing} />
      )}
      <MeetingPrep
        onOpenMail={m => {
          setActive({ id: m.accountId, openUid: m.uid, openFolder: m.folder });
          setModule('mail');
        }}
      />
      <ModuleShortcuts onModule={setModule} onAssistant={() => setAssistantOpen(o => !o)} />
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

function ModuleShortcuts({ onModule, onAssistant }: { onModule: (m: Module) => void; onAssistant: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onAssistant();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      // e.code, not e.key: on a Mac, Option + 1 types "¡" and the key would never match.
      const map: Record<string, Module> = {
        Digit1: 'mail',
        Digit2: 'calendar',
        Digit3: 'contacts',
        Digit4: 'spaces',
        Digit5: 'tasks',
        Comma: 'settings'
      };
      const target = map[e.code];
      if (target) {
        e.preventDefault();
        onModule(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onModule, onAssistant]);
  return null;
}

export default function App() {
  return (
    <ConfirmProvider>
      <Shell />
    </ConfirmProvider>
  );
}
