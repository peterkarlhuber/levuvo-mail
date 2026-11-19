// Folder sidebar of a mailbox: views, folders (drag & drop target, folder menu), account picker.
// Split out of MailInstance (ARC-LEV-005); the mailbox state stays there.
import { useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  AlarmClock,
  Archive,
  BellRing,
  ChevronDown,
  FilePenLine,
  FolderPlus,
  Inbox,
  Mail,
  Mails,
  MoreHorizontal,
  Paperclip,
  PenSquare,
  Send,
  ShieldAlert,
  Trash2
} from 'lucide-react';
import { focusFirstItem, menuKeyDown } from '../ui/menu-keys';
import { useT } from '../i18n';
import { isSnoozeFolder, special } from '../folder-utils';
import type { AccountItem, ApiStatus, Folder } from '../types';
import { ATTACHMENTS, FOLLOWUPS, UNIFIED } from './views';

const PROTECTED = new Set(['\\Inbox', '\\Drafts', '\\Sent', '\\Trash', '\\Junk', '\\Archive']);

function folderIcon(folder: Folder) {
  if (isSnoozeFolder(folder)) return AlarmClock;
  switch (folder.specialUse) {
    case '\\Inbox':
      return Inbox;
    case '\\Sent':
      return Send;
    case '\\Drafts':
      return FilePenLine;
    case '\\Archive':
      return Archive;
    case '\\Trash':
      return Trash2;
    case '\\Junk':
      return ShieldAlert;
    default:
      return folder.path.toUpperCase() === 'INBOX' ? Inbox : Mail;
  }
}

type Props = {
  accountId: string;
  accounts: AccountItem[];
  account?: AccountItem;
  status: ApiStatus | null;
  folder: string;
  folders: Folder[];
  ordered: { folder: Folder; depth: number }[];
  followupsDue: number;
  writeEnabled: boolean;
  actionBusy: boolean;
  mobileOpen: boolean;
  folderLabel: (f?: Folder) => string;
  acceptsDrop: (e: DragEvent, f: Folder) => boolean;
  onChooseFolder: (path: string) => void;
  onNewMessage: () => void;
  onDrop: (e: DragEvent, f: Folder) => void;
  onManageFolder: (op: 'create' | 'rename' | 'delete', target?: Folder) => void;
  onMarkLoadedRead: (path: string) => void;
  onSwitchAccount: (id: string) => void;
  onOpenAccounts: () => void;
  onCloseMobile: () => void;
};

export default function MailSidebar({
  accountId,
  accounts,
  account,
  status,
  folder,
  folders,
  ordered,
  followupsDue,
  writeEnabled,
  actionBusy,
  mobileOpen,
  folderLabel,
  acceptsDrop,
  onChooseFolder: chooseFolder,
  onNewMessage,
  onDrop,
  onManageFolder,
  onMarkLoadedRead,
  onSwitchAccount,
  onOpenAccounts,
  onCloseMobile
}: Props) {
  const { t } = useT();
  const unified = folder === UNIFIED;
  const followupView = folder === FOLLOWUPS;
  const attachmentView = folder === ATTACHMENTS;
  const mobileSidebar = mobileOpen;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  // Keyboard: focus moves into the folder menu when it opens and back to its button when it closes.
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuOpener = useRef<HTMLElement | null>(null);
  const folderMenuOpen = Boolean(folderMenu);
  useLayoutEffect(() => {
    if (folderMenuOpen) focusFirstItem(folderMenuRef.current);
  }, [folderMenuOpen]);
  const closeFolderMenu = (refocus: boolean) => {
    setFolderMenu(null);
    if (refocus) folderMenuOpener.current?.focus();
  };
  const menuFolder = folderMenu ? folders.find(f => f.path === folderMenu.path) : null;
  // A folder action closes the menu first.
  const manageFolder = (op: 'create' | 'rename' | 'delete', target?: Folder) => {
    setFolderMenu(null);
    onManageFolder(op, target);
  };

  return (
    <>
      <aside className={`sidebar ${mobileSidebar ? 'sidebar-open' : ''}`}>
        <div className="sidebar-inner">
          <div className="sidebar-brand">
            <img src="/levuvo-wordmark.png" alt="Levuvo" className="brand-image" />
            <span className="brand-product">
              mail<span className="brand-dot">.</span>
            </span>
          </div>
          <button className="compose-button" onClick={onNewMessage} disabled={!status?.configured}>
            <PenSquare size={17} />
            <span>{t('Neue Nachricht')}</span>
          </button>
          <nav className="folders" aria-label={t('Ordner')}>
            {accounts.length > 1 && (
              <button onClick={() => chooseFolder(UNIFIED)} className={`folder-item ${unified ? 'active' : ''}`}>
                <Mails size={16} strokeWidth={1.8} />
                <span>{t('Alle Posteingänge')}</span>
              </button>
            )}
            <button
              onClick={() => chooseFolder(FOLLOWUPS)}
              className={`folder-item ${followupView ? 'active' : ''}`}
              title={t('Gesendete Nachrichten ohne Antwort')}
            >
              <BellRing size={16} strokeWidth={1.8} />
              <span>{t('Nachfassen')}</span>
              {followupsDue > 0 && (
                <span className="folder-count attention" aria-label={t('{count} fällig', { count: followupsDue })}>
                  {followupsDue}
                </span>
              )}
            </button>
            <button
              onClick={() => chooseFolder(ATTACHMENTS)}
              className={`folder-item ${attachmentView ? 'active' : ''}`}
              title={t('Alle Dateien eines Ordners oder Kontakts')}
            >
              <Paperclip size={16} strokeWidth={1.8} />
              <span>{t('Anhänge')}</span>
            </button>
            {ordered.map(({ folder: f, depth }) => {
              const Icon = folderIcon(f);
              const count = ['\\Sent', '\\Drafts', '\\Trash', '\\Junk'].includes(f.specialUse || '') ? null : f.unseen;
              return (
                <div
                  key={f.path}
                  className={`folder-row ${dropTarget === f.path ? 'drop-target' : ''}`}
                  style={{ '--depth': depth } as CSSProperties}
                  onDragOver={e => {
                    if (acceptsDrop(e, f)) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDropTarget(f.path);
                    }
                  }}
                  onDragLeave={() => setDropTarget(old => (old === f.path ? null : old))}
                  onDrop={e => {
                    setDropTarget(null);
                    onDrop(e, f);
                  }}
                  onContextMenu={e => {
                    if (!writeEnabled) return;
                    e.preventDefault();
                    folderMenuOpener.current = e.currentTarget.querySelector('button');
                    setFolderMenu({ path: f.path, x: e.clientX, y: e.clientY });
                  }}
                >
                  <button
                    onClick={() => chooseFolder(f.path)}
                    className={`folder-item ${folder === f.path ? 'active' : ''}`}
                    title={f.path}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    <span>{folderLabel(f)}</span>
                    {count ? (
                      <span className="folder-count" aria-label={t('{count} ungelesen', { count })}>
                        {count > 999 ? '999+' : count}
                      </span>
                    ) : null}
                  </button>
                  {writeEnabled && (
                    <button
                      className="folder-more"
                      aria-label={t('Ordneraktionen: {folder}', { folder: folderLabel(f) })}
                      aria-haspopup="menu"
                      aria-expanded={folderMenu?.path === f.path}
                      onClick={e => {
                        folderMenuOpener.current = e.currentTarget;
                        const r = e.currentTarget.getBoundingClientRect();
                        setFolderMenu({ path: f.path, x: r.left, y: r.bottom });
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  )}
                </div>
              );
            })}
            {writeEnabled && (
              <button className="folder-item add-folder" onClick={() => manageFolder('create')}>
                <FolderPlus size={16} strokeWidth={1.8} />
                <span>{t('Neuer Ordner')}</span>
              </button>
            )}
          </nav>
          <div className="sidebar-footer">
            <label className="account-card account-picker">
              <span className="account-avatar">{(account?.label || 'L').trim().charAt(0).toUpperCase()}</span>
              <span className="account-data">
                <strong>{account?.label || t('Konto')}</strong>
                <small>{status?.mailbox || t('Nicht verbunden')}</small>
              </span>
              {accounts.length > 1 && <ChevronDown size={15} />}
              <select
                aria-label={t('Konto wechseln')}
                value={accountId}
                disabled={accounts.length < 2 || actionBusy}
                onChange={e => onSwitchAccount(e.target.value)}
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.label} — {a.mailbox || t('Nicht verbunden')}
                  </option>
                ))}
              </select>
            </label>
            <button className="text-button subtle account-settings-link" onClick={onOpenAccounts}>
              {t('Konten & Signaturen')}
            </button>
            <div className="sidebar-motto">Less effort. More impact.</div>
          </div>
        </div>
      </aside>
      {mobileSidebar && <button className="mobile-overlay" aria-label={t('Menü schließen')} onClick={onCloseMobile} />}
      {folderMenu && menuFolder && (
        <>
          <button className="menu-dismiss" aria-label={t('Menü schließen')} onClick={() => closeFolderMenu(true)} />
          <div
            ref={folderMenuRef}
            className="menu floating"
            role="menu"
            aria-label={t('Ordneraktionen: {folder}', { folder: folderLabel(menuFolder) })}
            style={{ left: folderMenu.x, top: folderMenu.y }}
            onKeyDown={e => menuKeyDown(e, closeFolderMenu)}
          >
            <button role="menuitem" onClick={() => manageFolder('create', menuFolder)}>
              {t('Unterordner anlegen')}
            </button>
            {!PROTECTED.has(special(menuFolder)) && (
              <button role="menuitem" onClick={() => manageFolder('rename', menuFolder)}>
                {t('Umbenennen')}
              </button>
            )}
            {!PROTECTED.has(special(menuFolder)) && (
              <button role="menuitem" className="danger" onClick={() => manageFolder('delete', menuFolder)}>
                {t('Löschen')}
              </button>
            )}
            {menuFolder.unseen ? (
              <button
                role="menuitem"
                onClick={() => {
                  setFolderMenu(null);
                  onMarkLoadedRead(menuFolder.path);
                }}
              >
                {t('Geladene als gelesen markieren')}
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
