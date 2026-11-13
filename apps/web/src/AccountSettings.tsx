import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  KeyRound,
  LoaderCircle,
  LogIn,
  Plug,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import { ApiError, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { RichTextField } from './editor';
import { useT } from './i18n';

type IdentityForm = { email: string; name: string; signatureHtml: string };
type Item = {
  id: string;
  label: string;
  user: string;
  managed: boolean;
  configured?: boolean;
  smtpUser?: string;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  sentFolder?: string;
  draftsFolder?: string;
  signature?: string;
  signatureHtml?: string;
  displayName?: string;
  identities?: IdentityForm[];
  sieveHost?: string;
  sievePort?: number;
  auth?: 'password' | 'oauth2';
  oauthProvider?: string;
};
type Management = { vaultAvailable: boolean; accounts: Item[]; oauthProviders?: { id: string; name: string }[] };
type Form = {
  id?: string;
  provider: string;
  label: string;
  user: string;
  password: string;
  smtpUser: string;
  smtpPassword: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  sentFolder: string;
  draftsFolder: string;
  displayName: string;
  signatureHtml: string;
  identities: IdentityForm[];
  sieveHost: string;
  sievePort: number;
  auth: 'password' | 'oauth2';
};

// Server data verified against the providers' own documentation.
const PROVIDERS: {
  id: string;
  name: string;
  imap: string;
  smtp: string;
  smtpPort: number;
  domains: string[];
  hint?: string;
  oauth?: string;
}[] = [
  {
    id: 'hetzner',
    name: 'Hetzner',
    imap: 'mail.your-server.de',
    smtp: 'mail.your-server.de',
    smtpPort: 587,
    domains: []
  },
  { id: 'ionos', name: 'IONOS', imap: 'imap.ionos.de', smtp: 'smtp.ionos.de', smtpPort: 587, domains: [] },
  { id: 'strato', name: 'Strato', imap: 'imap.strato.de', smtp: 'smtp.strato.de', smtpPort: 465, domains: [] },
  {
    id: 'easyname',
    name: 'easyname',
    imap: 'imap.easyname.com',
    smtp: 'smtp.easyname.com',
    smtpPort: 465,
    domains: []
  },
  {
    id: 'gmx',
    name: 'GMX',
    imap: 'imap.gmx.net',
    smtp: 'mail.gmx.net',
    smtpPort: 587,
    domains: ['gmx.at', 'gmx.de', 'gmx.net', 'gmx.ch'],
    hint: 'IMAP muss in den GMX-Einstellungen aktiviert sein.'
  },
  {
    id: 'webde',
    name: 'WEB.DE',
    imap: 'imap.web.de',
    smtp: 'smtp.web.de',
    smtpPort: 587,
    domains: ['web.de'],
    hint: 'IMAP muss in den WEB.DE-Einstellungen aktiviert sein.'
  },
  {
    id: 'gmail',
    name: 'Gmail',
    imap: 'imap.gmail.com',
    smtp: 'smtp.gmail.com',
    smtpPort: 465,
    domains: ['gmail.com', 'googlemail.com'],
    oauth: 'google',
    hint: 'Ohne „Mit Google anmelden“ verlangt Gmail ein App-Passwort (Google-Konto → Sicherheit → 2-Schritt-Verifizierung → App-Passwörter).'
  },
  {
    id: 'microsoft',
    name: 'Microsoft 365 / Outlook.com',
    imap: 'outlook.office365.com',
    smtp: 'smtp.office365.com',
    smtpPort: 587,
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'outlook.at', 'outlook.de'],
    oauth: 'microsoft',
    hint: 'Microsoft erlaubt die Anmeldung nur noch per „Mit Microsoft anmelden“ (OAuth).'
  },
  { id: 'custom', name: 'Anderer Anbieter', imap: '', smtp: '', smtpPort: 587, domains: [] }
];

const TILE_ORDER = ['microsoft', 'gmail', 'gmx', 'webde', 'ionos', 'hetzner', 'strato', 'easyname', 'custom'];
const MONOGRAM: Record<string, string> = {
  microsoft: 'M',
  gmail: 'G',
  gmx: 'GMX',
  webde: 'W',
  ionos: 'I',
  hetzner: 'H',
  strato: 'S',
  easyname: 'e'
};

const EMPTY: Form = {
  provider: 'hetzner',
  label: '',
  user: '',
  password: '',
  smtpUser: '',
  smtpPassword: '',
  imapHost: PROVIDERS[0].imap,
  imapPort: 993,
  smtpHost: PROVIDERS[0].smtp,
  smtpPort: 587,
  sentFolder: '',
  draftsFolder: '',
  displayName: '',
  signatureHtml: '',
  identities: [],
  sieveHost: '',
  sievePort: 4190,
  auth: 'password'
};
const providerFor = (form: Pick<Form, 'imapHost'>) =>
  PROVIDERS.find(p => p.imap && p.imap === form.imapHost)?.id || 'custom';
const textToHtml = (s: string) =>
  s
    ? `<p>${s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/\n/g, '<br>')}</p>`
    : '';

/** Sign-in with Microsoft / Google: browser opens, the app polls until the account exists. */
export function useOAuthSignIn(onDone: () => Promise<void>) {
  const { t } = useT();
  const [state, setState] = useState<{ provider: string; busy: boolean; error: string }>({
    provider: '',
    busy: false,
    error: ''
  });
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
    },
    []
  );
  /** `accountId`: renew the consent of an existing account (calendar & contacts). */
  async function start(provider: string, accountId?: string) {
    setState({ provider, busy: true, error: '' });
    try {
      const { state: key, authUrl } = await postJson<{ state: string; authUrl: string }>(
        '/api/oauth/start',
        accountId ? { provider, accountId } : { provider },
        'accounts-v1'
      );
      window.open(authUrl, '_blank', 'noopener');
      const started = Date.now();
      timer.current = window.setInterval(async () => {
        const s = await getJson<{ status: string; error: string | null }>(
          `/api/oauth/status?state=${encodeURIComponent(key)}`
        ).catch(() => null);
        const expired = Date.now() - started > 10 * 60_000;
        if (s?.status === 'done' || s?.status === 'failed' || expired) {
          window.clearInterval(timer.current!);
          timer.current = null;
          if (s?.status === 'done') {
            setState({ provider: '', busy: false, error: '' });
            await onDone();
          } else setState({ provider, busy: false, error: s?.error || t('Die Anmeldung wurde nicht abgeschlossen.') });
        }
      }, 1500);
    } catch (err) {
      setState({ provider, busy: false, error: (err as Error).message });
    }
  }
  function cancel() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setState({ provider: '', busy: false, error: '' });
  }
  return { ...state, start, cancel };
}

export function OAuthButtons({
  providers,
  onDone
}: {
  providers: { id: string; name: string }[];
  onDone: () => Promise<void>;
}) {
  const { t } = useT();
  const oauth = useOAuthSignIn(onDone);
  if (!providers.length) return null;
  return (
    <div className="oauth-buttons">
      {providers.map(p => (
        <button
          key={p.id}
          type="button"
          className={`btn oauth-${p.id}`}
          disabled={oauth.busy}
          onClick={() => void oauth.start(p.id)}
        >
          {oauth.busy && oauth.provider === p.id ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}
          {p.id === 'microsoft' ? t('Mit Microsoft anmelden') : p.id === 'google' ? t('Mit Google anmelden') : p.name}
        </button>
      ))}
      {oauth.busy && (
        <p className="managed-hint">
          {t('Bitte im Browser anmelden. Dieses Fenster aktualisiert sich danach automatisch.')}{' '}
          <button type="button" className="text-button" onClick={oauth.cancel}>
            {t('Abbrechen')}
          </button>
        </p>
      )}
      {oauth.error && (
        <p className="modal-error" role="alert">
          {oauth.error}
        </p>
      )}
    </div>
  );
}

export default function AccountSettings({
  onChanged,
  onboarding = false
}: {
  onChanged: () => Promise<void>;
  onboarding?: boolean;
}) {
  const { t } = useT();
  const { confirm } = useUi();
  const [info, setInfo] = useState<Management | null>(null);
  const [working, setWorking] = useState<'' | 'save' | 'verify' | 'other'>('');
  const [edit, setEdit] = useState<Form | null>(onboarding ? { ...EMPTY } : null);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<string | undefined>();
  const [canOverride, setCanOverride] = useState(false);
  const [notice, setNotice] = useState('');

  async function reload() {
    setInfo(await getJson<Management>('/api/accounts/management'));
  }
  useEffect(() => {
    void reload().catch(e => setError((e as Error).message));
  }, []);
  const oauthProviders = info?.oauthProviders || [];

  const provider = PROVIDERS.find(p => p.id === edit?.provider) || PROVIDERS[PROVIDERS.length - 1];
  const oauthForProvider = provider.oauth ? oauthProviders.find(p => p.id === provider.oauth) : undefined;
  const resetMessages = () => {
    setError('');
    setErrorField(undefined);
    setNotice('');
    setCanOverride(false);
  };

  function startEdit(item: Item) {
    resetMessages();
    const form: Form = {
      ...EMPTY,
      id: item.id,
      label: item.label,
      user: item.user,
      password: '',
      smtpPassword: '',
      provider: 'custom',
      smtpUser: item.smtpUser || item.user,
      imapHost: item.imapHost || '',
      smtpHost: item.smtpHost || '',
      imapPort: item.imapPort || 993,
      smtpPort: item.smtpPort || 587,
      sentFolder: item.sentFolder || '',
      draftsFolder: item.draftsFolder || '',
      displayName: item.displayName || '',
      signatureHtml: item.signatureHtml || textToHtml(item.signature || ''),
      identities: (item.identities || []).map(i => ({
        email: i.email,
        name: i.name || '',
        signatureHtml: i.signatureHtml || ''
      })),
      sieveHost: item.sieveHost || '',
      sievePort: item.sievePort || 4190,
      auth: item.auth === 'oauth2' ? 'oauth2' : 'password'
    };
    form.provider = providerFor(form);
    setAdvanced(form.provider === 'custom' && form.auth !== 'oauth2');
    setEdit(form);
  }
  function chooseProvider(id: string) {
    if (!edit) return;
    const p = PROVIDERS.find(x => x.id === id)!;
    setEdit({
      ...edit,
      provider: id,
      imapHost: p.imap || edit.imapHost,
      smtpHost: p.smtp || edit.smtpHost,
      smtpPort: p.smtpPort
    });
    if (id === 'custom') setAdvanced(true);
  }
  function setEmail(value: string) {
    if (!edit) return;
    const domain = value.split('@')[1]?.toLowerCase() || '';
    const match = PROVIDERS.find(p => p.domains.includes(domain));
    const next = { ...edit, user: value };
    if (match && !edit.id)
      Object.assign(next, { provider: match.id, imapHost: match.imap, smtpHost: match.smtp, smtpPort: match.smtpPort });
    setEdit(next);
  }

  const payload = (form: Form, allowUnverified = false) => ({
    id: form.id,
    label: form.label || form.user,
    user: form.user,
    password: form.password,
    smtpUser: form.smtpUser || form.user,
    smtpPassword: form.smtpPassword,
    imapHost: form.imapHost.trim(),
    imapPort: form.imapPort,
    smtpHost: form.smtpHost.trim(),
    smtpPort: form.smtpPort,
    sentFolder: form.sentFolder.trim(),
    draftsFolder: form.draftsFolder.trim(),
    displayName: form.displayName.trim(),
    signatureHtml: form.signatureHtml,
    identities: form.identities.filter(i => i.email.trim()).map(i => ({ ...i, email: i.email.trim().toLowerCase() })),
    sieveHost: form.sieveHost.trim(),
    sievePort: form.sievePort,
    allowUnverified
  });

  function showError(err: unknown) {
    const e = err as ApiError;
    setError(e.message);
    setErrorField(e.field);
    setCanOverride(Boolean(e.retryable));
  }
  async function verify() {
    if (!edit) return;
    resetMessages();
    setWorking('verify');
    try {
      await postJson('/api/accounts/verify', payload(edit), 'accounts-v1');
      setNotice(t('Verbindung erfolgreich: Empfang (IMAP) und Versand (SMTP) funktionieren.'));
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }
  async function save(event?: FormEvent, allowUnverified = false) {
    event?.preventDefault();
    if (!edit) return;
    const isEdit = Boolean(edit.id);
    if (!isEdit && !edit.password) {
      setError(t('Bitte das Passwort eingeben.'));
      return;
    }
    resetMessages();
    setWorking('save');
    try {
      const result = await postJson<{ account: { verified: boolean } }>(
        isEdit ? '/api/accounts/update' : '/api/accounts/create',
        payload(edit, allowUnverified),
        'accounts-v1'
      );
      await reload();
      setEdit(null);
      setNotice(
        result.account.verified === false
          ? t('Gespeichert, aber noch nicht geprüft: Der Server war nicht erreichbar.')
          : isEdit
            ? t('Kontoeinstellungen gespeichert.')
            : t('Konto eingerichtet. Die Verbindung wurde erfolgreich geprüft.')
      );
      await onChanged();
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }
  async function adopt(item: Item) {
    if (
      !(await confirm({
        title: t('In den Schlüsselbund übernehmen?'),
        message: t(
          '{user}: Das Passwort wird in den Schlüsselbund des Betriebssystems verschoben. Auf dem Mailserver ändert sich nichts.',
          { user: item.user }
        ),
        confirmLabel: t('Übernehmen')
      }))
    )
      return;
    setWorking('other');
    resetMessages();
    try {
      await postJson('/api/accounts/adopt', { id: item.id, confirm: 'MIGRATE_TO_KEYCHAIN' }, 'accounts-v1');
      await reload();
      await onChanged();
      setNotice(t('Im Schlüsselbund gespeichert.'));
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }
  async function remove(item: Item) {
    if (
      !(await confirm({
        title: t('{label} entfernen?', { label: item.label }),
        message: t(
          'Nur die Einrichtung auf diesem Gerät wird entfernt (inkl. Suchindex). Alle E-Mails bleiben auf dem Mailserver erhalten.'
        ),
        confirmLabel: t('Konto entfernen'),
        danger: true
      }))
    )
      return;
    setWorking('other');
    resetMessages();
    try {
      const result = await postJson<{ cleanupFailed: boolean }>(
        '/api/accounts/remove',
        { id: item.id, confirm: 'REMOVE_LOCAL_ACCOUNT' },
        'accounts-v1'
      );
      await reload();
      await onChanged();
      setNotice(
        result.cleanupFailed
          ? t('Konto entfernt. Der Eintrag im Schlüsselbund konnte nicht vollständig gelöscht werden.')
          : t('Konto auf diesem Gerät entfernt.')
      );
    } catch (err) {
      showError(err);
    } finally {
      setWorking('');
    }
  }

  const field = (name: string) => (errorField && name.startsWith(errorField) ? 'has-error' : '');
  const busy = working !== '';
  const oauthAccount = edit?.auth === 'oauth2';
  const setIdentity = (i: number, patch: Partial<IdentityForm>) =>
    edit && setEdit({ ...edit, identities: edit.identities.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <section className="managed-accounts" aria-label={t('Kontenverwaltung')}>
      {!onboarding && (
        <div className="managed-accounts-head">
          <h3>
            {t('E-Mail-Konten')}
            <span className="period">.</span>
          </h3>
          <button
            className="btn"
            disabled={busy || !info?.vaultAvailable || Boolean(edit) || (info?.accounts.length || 0) >= 5}
            onClick={() => {
              resetMessages();
              setAdvanced(false);
              setEdit({ ...EMPTY });
            }}
          >
            <Plus size={16} /> {t('Konto hinzufügen')}
          </button>
        </div>
      )}
      <p className="managed-explain">
        <ShieldCheck size={14} />{' '}
        {t('Passwörter und Anmelde-Token liegen ausschließlich im Schlüsselbund des Betriebssystems.')}
      </p>
      {info && !info.vaultAvailable && (
        <p className="compose-warning">
          <KeyRound size={15} />{' '}
          {t(
            'Der Schlüsselbund ist nicht verfügbar. Bitte entsperren und Levuvo Mail neu starten. Es gibt bewusst keinen unverschlüsselten Ersatzspeicher.'
          )}
        </p>
      )}
      {(onboarding || !edit) && oauthProviders.length > 0 && info?.vaultAvailable && info.accounts.length < 5 && (
        <OAuthButtons
          providers={oauthProviders}
          onDone={async () => {
            await reload();
            await onChanged();
            setNotice(t('Konto verbunden.'));
          }}
        />
      )}
      {!onboarding &&
        info?.accounts.map(item => (
          <div className="managed-item" key={item.id}>
            <div className="managed-item-name">
              <strong>{item.label}</strong>
              <small>
                {item.user || t('Nicht eingerichtet')}
                {item.identities?.length
                  ? ` · ${t('+{count} Absenderadressen', { count: item.identities.length })}`
                  : ''}
              </small>
              {item.auth === 'oauth2' && (
                <span className="tag">{item.oauthProvider === 'google' ? 'Google' : 'Microsoft'} OAuth</span>
              )}
              {!item.managed && <span className="tag warn">{t('ALTE KONFIGURATION')}</span>}
            </div>
            <div className="managed-item-actions">
              {item.managed ? (
                <>
                  <button className="btn small" disabled={busy || Boolean(edit)} onClick={() => startEdit(item)}>
                    {t('Bearbeiten')}
                  </button>
                  <button
                    className="btn small"
                    disabled={busy}
                    aria-label={t('{label} entfernen', { label: item.label })}
                    title={t('Konto entfernen')}
                    onClick={() => void remove(item)}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              ) : (
                <button
                  className="btn small"
                  disabled={busy || !info.vaultAvailable || !item.configured}
                  onClick={() => void adopt(item)}
                >
                  {t('In Schlüsselbund übernehmen')} <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      {edit && (
        <form className="managed-form" onSubmit={e => void save(e)} autoComplete="off">
          <div className="managed-form-head">
            <strong>{edit.id ? t('Konto bearbeiten') : t('Neues Postfach')}</strong>
            {!onboarding && (
              <button
                type="button"
                className="icon-button"
                disabled={busy}
                aria-label={t('Schließen')}
                onClick={() => {
                  setEdit(null);
                  resetMessages();
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
          {!oauthAccount && !edit.id && (
            <div className="provider-tiles" role="radiogroup" aria-label={t('Anbieter')}>
              {TILE_ORDER.map(id => PROVIDERS.find(p => p.id === id)!).map(p => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={edit.provider === p.id}
                  className={`provider-tile ${edit.provider === p.id ? 'active' : ''}`}
                  onClick={() => chooseProvider(p.id)}
                >
                  <span className="provider-mark" aria-hidden="true">
                    {p.id === 'custom' ? <Server size={15} /> : MONOGRAM[p.id] || p.name[0]}
                  </span>
                  <span className="provider-name">
                    {p.id === 'custom' ? t('Anderer Anbieter') : p.name.replace(' / Outlook.com', '')}
                  </span>
                </button>
              ))}
            </div>
          )}
          {!oauthAccount && edit.id && (
            <label className="provider-field">
              {t('Anbieter')}
              <select value={edit.provider} onChange={e => chooseProvider(e.target.value)}>
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.id === 'custom' ? t('Anderer Anbieter') : p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!oauthAccount && provider.hint && <p className="managed-hint">{t(provider.hint)}</p>}
          {!oauthAccount && !edit.id && oauthForProvider && (
            <OAuthButtons
              providers={[oauthForProvider]}
              onDone={async () => {
                setEdit(null);
                await reload();
                await onChanged();
                setNotice(t('Konto verbunden.'));
              }}
            />
          )}
          {!oauthAccount && !edit.id && provider.oauth && !oauthForProvider && (
            <p className="managed-hint">
              {t(
                'Die Anmeldung per OAuth ist in diesem Build nicht freigeschaltet (Client-ID fehlt). Siehe Handbuch, Kapitel „OAuth einrichten“.'
              )}
            </p>
          )}
          <div className="managed-field-grid">
            <label className={field('user')}>
              {t('E-Mail-Adresse')}
              <input
                type="email"
                value={edit.user}
                required
                maxLength={254}
                autoFocus={!edit.id}
                readOnly={oauthAccount}
                onChange={e => setEmail(e.target.value)}
              />
            </label>
            {!oauthAccount && (
              <label className={field('imap')}>
                {t('Passwort')} {edit.id ? t('(leer = unverändert)') : ''}
                <input
                  type="password"
                  value={edit.password}
                  required={!edit.id}
                  autoComplete="new-password"
                  onChange={e => setEdit({ ...edit, password: e.target.value })}
                />
              </label>
            )}
            <label>
              {t('Kontoname')}
              <input
                value={edit.label}
                maxLength={80}
                placeholder={t('z. B. Büro')}
                onChange={e => setEdit({ ...edit, label: e.target.value })}
              />
            </label>
            <label>
              {t('Dein Name (Absender)')}
              <input
                value={edit.displayName}
                maxLength={120}
                placeholder={t('z. B. Karl Huber')}
                onChange={e => setEdit({ ...edit, displayName: e.target.value })}
              />
            </label>
          </div>
          {!oauthAccount && (
            <button
              type="button"
              className="text-button"
              onClick={() => setAdvanced(!advanced)}
              aria-expanded={advanced}
            >
              {advanced ? t('Servereinstellungen ausblenden') : t('Servereinstellungen anzeigen')}
            </button>
          )}
          {advanced && !oauthAccount && (
            <div className="managed-field-grid">
              <label className={field('imap')}>
                {t('Eingang (IMAP)')}
                <input
                  value={edit.imapHost}
                  required
                  placeholder="imap.anbieter.at"
                  onChange={e => setEdit({ ...edit, imapHost: e.target.value, provider: 'custom' })}
                />
              </label>
              <label>
                {t('IMAP-Port')}
                <input
                  type="number"
                  value={993}
                  readOnly
                  title={t('Nur verschlüsseltes IMAP (993/TLS) wird unterstützt.')}
                />
              </label>
              <label className={field('smtp')}>
                {t('Ausgang (SMTP)')}
                <input
                  value={edit.smtpHost}
                  required
                  placeholder="smtp.anbieter.at"
                  onChange={e => setEdit({ ...edit, smtpHost: e.target.value, provider: 'custom' })}
                />
              </label>
              <label className={field('smtp')}>
                {t('SMTP-Port')}
                <select value={edit.smtpPort} onChange={e => setEdit({ ...edit, smtpPort: Number(e.target.value) })}>
                  <option value={587}>587 · STARTTLS</option>
                  <option value={465}>465 · TLS</option>
                </select>
              </label>
              <label className={field('smtp')}>
                {t('SMTP-Benutzer')}
                <input
                  type="email"
                  placeholder={t('wie E-Mail-Adresse')}
                  value={edit.smtpUser}
                  onChange={e => setEdit({ ...edit, smtpUser: e.target.value })}
                />
              </label>
              <label className={field('smtp')}>
                {t('SMTP-Passwort')}
                <input
                  type="password"
                  placeholder={t('wie oben')}
                  value={edit.smtpPassword}
                  autoComplete="new-password"
                  onChange={e => setEdit({ ...edit, smtpPassword: e.target.value })}
                />
              </label>
              <label>
                {t('Gesendet-Ordner')}
                <input
                  value={edit.sentFolder}
                  placeholder={t('automatisch')}
                  onChange={e => setEdit({ ...edit, sentFolder: e.target.value })}
                />
              </label>
              <label>
                {t('Entwürfe-Ordner')}
                <input
                  value={edit.draftsFolder}
                  placeholder={t('automatisch')}
                  onChange={e => setEdit({ ...edit, draftsFolder: e.target.value })}
                />
              </label>
              <label>
                {t('Filterserver (Sieve)')}
                <input
                  value={edit.sieveHost}
                  placeholder={t('wie IMAP')}
                  onChange={e => setEdit({ ...edit, sieveHost: e.target.value })}
                />
              </label>
              <label>
                {t('Sieve-Port')}
                <select value={edit.sievePort} onChange={e => setEdit({ ...edit, sievePort: Number(e.target.value) })}>
                  <option value={4190}>4190</option>
                  <option value={2000}>2000</option>
                </select>
              </label>
            </div>
          )}
          {edit.id && (
            <fieldset className="identity-section">
              <legend>{t('Signatur')}</legend>
              <p className="managed-hint">
                {t(
                  'Formatierter Text, Links und ein kleines Logo (bis 200 KB) sind möglich. Wird beim Verfassen automatisch eingefügt.'
                )}
              </p>
              <RichTextField
                label={t('Signatur für {email}', { email: edit.user })}
                value={edit.signatureHtml}
                onChange={html => setEdit(old => (old ? { ...old, signatureHtml: html } : old))}
              />
            </fieldset>
          )}
          {edit.id && (
            <fieldset className="identity-section">
              <legend>{t('Weitere Absenderadressen (Aliase)')}</legend>
              <p className="managed-hint">
                {t(
                  'Nur Adressen eintragen, die dein Mailserver für dieses Postfach zum Senden erlaubt – sonst lehnt er den Versand ab.'
                )}
              </p>
              {edit.identities.map((identity, i) => (
                <div className="identity-card" key={i}>
                  <div className="identity-head">
                    <UserRound size={15} />
                    <input
                      type="email"
                      aria-label={t('Absenderadresse')}
                      placeholder="info@firma.at"
                      value={identity.email}
                      onChange={e => setIdentity(i, { email: e.target.value })}
                    />
                    <input
                      aria-label={t('Name')}
                      placeholder={t('Name')}
                      value={identity.name}
                      onChange={e => setIdentity(i, { name: e.target.value })}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('Absenderadresse entfernen')}
                      onClick={() => setEdit({ ...edit, identities: edit.identities.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <RichTextField
                    label={t('Signatur für {email}', { email: identity.email || t('Alias') })}
                    value={identity.signatureHtml}
                    onChange={html => setIdentity(i, { signatureHtml: html })}
                  />
                </div>
              ))}
              {edit.identities.length < 10 && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    setEdit({
                      ...edit,
                      identities: [...edit.identities, { email: '', name: edit.displayName, signatureHtml: '' }]
                    })
                  }
                >
                  <Plus size={14} /> {t('Absenderadresse hinzufügen')}
                </button>
              )}
            </fieldset>
          )}
          {error && (
            <div className="modal-error" role="alert">
              <span>{error}</span>
              {canOverride && (
                <button type="button" className="text-button" onClick={() => void save(undefined, true)}>
                  {t('Trotzdem speichern und später prüfen')}
                </button>
              )}
            </div>
          )}
          <div className="managed-form-buttons">
            {!oauthAccount && (
              <button
                className="btn"
                type="button"
                onClick={() => void verify()}
                disabled={busy || !edit.user || (!edit.password && !edit.id)}
              >
                {working === 'verify' ? <LoaderCircle className="spin" size={16} /> : <Plug size={16} />}{' '}
                {t('Verbindung testen')}
              </button>
            )}
            <button className="btn primary" type="submit" disabled={busy}>
              {working === 'save' ? (
                <>
                  {t('Prüfe Verbindung …')} <LoaderCircle className="spin" size={16} />
                </>
              ) : (
                <>
                  {edit.id ? t('Speichern') : t('Konto einrichten')} <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
        </form>
      )}
      {!edit && error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="managed-notice" role="status">
          <Check size={15} /> {notice}
        </p>
      )}
      {!onboarding && (
        <p className="managed-footnote">
          {t('Bis zu fünf Postfächer. „Entfernen“ betrifft nur dieses Gerät, niemals E-Mails auf dem Server.')}
        </p>
      )}
    </section>
  );
}
