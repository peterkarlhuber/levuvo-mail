import { useMemo, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, LoaderCircle, MailX, Newspaper, Receipt } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import type { Bundle, Detail, Message } from './types';

export const BUNDLE_ORDER: Bundle[] = ['invoice', 'notification', 'newsletter'];

const ICONS = { newsletter: Newspaper, invoice: Receipt, notification: Bell };

export function useBundleLabel() {
  const { t } = useT();
  return (b: Bundle) =>
    b === 'newsletter' ? t('Newsletter') : b === 'invoice' ? t('Rechnungen') : t('Benachrichtigungen');
}

type SenderGroup = { email: string; name: string; uids: number[]; newest: Message };

function senders(messages: Message[]): SenderGroup[] {
  const map = new Map<string, SenderGroup>();
  for (const m of messages) {
    const email = m.fromEmail.toLowerCase();
    const group = map.get(email);
    if (group) group.uids.push(m.uid);
    else map.set(email, { email, name: m.fromName || m.fromEmail, uids: [m.uid], newest: m });
  }
  return [...map.values()].sort((a, b) => b.uids.length - a.uids.length);
}

/** Collapsed bundle rows at the top of the inbox. */
export function BundleRows({ messages, onOpen }: { messages: Message[]; onOpen: (b: Bundle) => void }) {
  const { t } = useT();
  const label = useBundleLabel();
  const rows = BUNDLE_ORDER.map(b => {
    const members = messages.filter(m => m.bundle === b);
    const names = [...new Set(members.map(m => m.fromName || m.fromEmail))].slice(0, 3);
    return { b, members, names, unread: members.filter(m => m.unread).length };
  }).filter(r => r.members.length);
  if (!rows.length) return null;
  return (
    <div className="bundle-rows" role="group" aria-label={t('Bündel')}>
      {rows.map(({ b, members, names, unread }) => {
        const Icon = ICONS[b];
        return (
          <button key={b} className={`bundle-row ${unread ? 'unread' : ''}`} onClick={() => onOpen(b)}>
            <span className={`bundle-icon bundle-${b}`}>
              <Icon size={16} aria-hidden="true" />
            </span>
            <span className="bundle-text">
              <strong>
                {label(b)}
                {members.some(m => m.bundleSource === 'ai') && (
                  <span
                    className="ai-badge"
                    title={t('Teilweise von der KI einsortiert: {reason}', {
                      reason: members.find(m => m.bundleReason)?.bundleReason || t('Vorschlag des Assistenten')
                    })}
                  >
                    {t('KI')}
                  </span>
                )}
              </strong>
              <span>{names.join(', ')}</span>
            </span>
            <span className="bundle-count">
              {unread > 0 ? t('{count} neu', { count: unread }) : String(members.length)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Header of an opened bundle: back, mark all read and – for newsletters – unsubscribe per sender. */
export function BundleHeader({
  bundle,
  messages,
  accountId,
  folder,
  writeEnabled,
  onBack,
  onAction
}: {
  bundle: Bundle;
  messages: Message[];
  accountId: string;
  folder: string;
  writeEnabled: boolean;
  onBack: () => void;
  onAction: (action: 'markRead' | 'trash', uids: number[]) => void;
}) {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const label = useBundleLabel();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const members = useMemo(() => messages.filter(m => m.bundle === bundle), [messages, bundle]);
  const unread = members.filter(m => m.unread).map(m => m.uid);
  const groups = useMemo(() => (bundle === 'newsletter' ? senders(members).slice(0, 12) : []), [bundle, members]);

  async function unsubscribe(group: SenderGroup) {
    setBusy(group.email);
    try {
      // Read without marking as read: the detail carries the sender's unsubscribe offer.
      const detail = await getJson<Detail>(
        `/api/messages/${group.newest.uid}?folder=${encodeURIComponent(folder)}`,
        accountId
      );
      const u = detail.unsubscribe;
      if (!u) {
        toast({ text: t('Diese Nachricht bietet keine Abmeldung an.'), kind: 'error' });
        return;
      }
      const how =
        u.method === 'one-click'
          ? t('Levuvo Mail meldet dich direkt beim Absender ab ({host}).', { host: u.host || '' })
          : u.method === 'mail'
            ? t('Levuvo Mail sendet eine Abmelde-E-Mail an {to}.', { to: u.mailto || '' })
            : t('Die Abmeldeseite des Absenders wird im Browser geöffnet ({host}).', { host: u.host || '' });
      const ok = await confirm({
        title: t('Von „{sender}“ abmelden?', { sender: group.name }),
        message: how,
        confirmLabel: u.method === 'web' ? t('Seite öffnen') : t('Abmelden')
      });
      if (!ok) return;
      if (u.method === 'web' && u.url) {
        window.open(u.url, '_blank', 'noopener,noreferrer');
        return;
      }
      await postJson('/api/messages/unsubscribe', { folder, uid: group.newest.uid }, 'mail-v1', accountId);
      setDone(old => [...old, group.email]);
      toast({
        text: t('Abgemeldet. Es kann einige Tage dauern, bis keine Post mehr kommt.'),
        kind: 'success',
        ...(writeEnabled
          ? {
              action: {
                label: t('{count} Nachrichten löschen', { count: group.uids.length }),
                run: () => onAction('trash', group.uids)
              }
            }
          : {})
      });
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bundle-header">
      <div className="bundle-header-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={14} /> {t('Posteingang')}
        </button>
        <strong>{label(bundle)}</strong>
        {writeEnabled && unread.length > 0 && (
          <button className="btn small" onClick={() => onAction('markRead', unread)}>
            <CheckCheck size={14} /> {t('Alle als gelesen')}
          </button>
        )}
      </div>
      {groups.length > 0 && (
        <ul className="bundle-senders" aria-label={t('Absender')}>
          {groups.map(g => (
            <li key={g.email}>
              <span title={g.email}>
                {g.name} <small>· {g.uids.length}</small>
              </span>
              {done.includes(g.email) ? (
                <small>{t('Abgemeldet')}</small>
              ) : (
                <button
                  className="text-button"
                  disabled={busy !== null}
                  onClick={() => void unsubscribe(g)}
                  aria-label={t('Von „{sender}“ abmelden?', { sender: g.name })}
                >
                  {busy === g.email ? <LoaderCircle size={12} className="spin" /> : <MailX size={12} />} {t('Abmelden')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
