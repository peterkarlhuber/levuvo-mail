// Out-of-office reply for accounts signed in with Microsoft 365 / Outlook.com or Google: stored
// with the provider (they have no ManageSieve), so it also answers while Levuvo Mail is closed.
import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Save } from 'lucide-react';
import { getJson, postJson } from './api';
import { useOAuthSignIn } from './AccountSettings';
import { useUi } from './ConfirmDialog';
import { RichTextField } from './editor';
import { useT } from './i18n';
import { Section } from './Settings';
import { Button } from './ui';

type Reply = {
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  includeSignature: boolean;
  start: string;
  end: string;
  audience: 'all' | 'contacts' | 'internal';
};
type State = {
  available: boolean;
  consentRequired?: boolean;
  provider?: 'microsoft' | 'google';
  reply?: Reply;
};

export function ProviderAutoReply({ accountId, onDirty }: { accountId: string; onDirty: (dirty: boolean) => void }) {
  const { t } = useT();
  const { toast } = useUi();
  const [state, setState] = useState<State | null>(null);
  const [reply, setReply] = useState<Reply | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setDirty = (value: boolean) => {
    setDirtyState(value);
    onDirty(value);
  };
  const load = useCallback(async () => {
    setError('');
    try {
      const s = await getJson<State>('/api/auto-reply', accountId);
      setState(s);
      setReply(s.reply || null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [accountId]);
  const oauth = useOAuthSignIn(load);
  useEffect(() => {
    void load();
  }, [load]);
  const set = (patch: Partial<Reply>) => {
    if (!reply) return;
    setReply({ ...reply, ...patch });
    setDirty(true);
  };
  const provider = state?.provider;
  const providerName = provider === 'microsoft' ? 'Microsoft 365' : 'Gmail';

  async function save() {
    if (!reply) return;
    setBusy(true);
    setError('');
    try {
      const result = await postJson<{ removedImages?: number }>('/api/auto-reply', { reply }, 'mail-v1', accountId);
      setDirty(false);
      toast(
        result?.removedImages
          ? {
              text: t(
                'Gespeichert. {provider} übernimmt keine eingebetteten Bilder – die Abwesenheitsnotiz wurde ohne Logo gespeichert.',
                { provider: providerName }
              ),
              kind: 'info'
            }
          : {
              text: t('Die Abwesenheitsnotiz ist bei {provider} gespeichert.', { provider: providerName }),
              kind: 'success'
            }
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'autoreply_consent_required')
        setState(s => ({ ...(s || { available: true }), consentRequired: true }));
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!state && !error)
    return (
      <p className="muted">
        <LoaderCircle size={14} className="spin" /> {t('Lade Abwesenheitsnotiz …')}
      </p>
    );
  return (
    <>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {state && !state.available && (
        <p className="muted">{t('Für dieses Konto ist keine Abwesenheitsnotiz verfügbar.')}</p>
      )}
      {state?.consentRequired && (
        <Section
          title={t('Abwesenheitsnotiz')}
          description={t(
            'Damit Levuvo Mail die Abwesenheitsnotiz beim Anbieter speichern darf, ist eine einmalige Freigabe nötig. Es öffnet sich die Anmeldeseite des Anbieters für dieses Konto.'
          )}
        >
          <Button
            variant="primary"
            busy={oauth.busy}
            onClick={() => void oauth.start(provider || 'microsoft', accountId)}
          >
            {oauth.busy ? t('Warte auf Freigabe …') : t('Freigeben')}
          </Button>
          {oauth.error && (
            <p className="modal-error" role="alert">
              {oauth.error}
            </p>
          )}
        </Section>
      )}
      {state?.available && !state.consentRequired && reply && (
        <>
          <Section
            title={t('Abwesenheitsnotiz')}
            description={t(
              'Wird bei {provider} gespeichert und von dort automatisch beantwortet – auch wenn Levuvo Mail geschlossen ist.',
              { provider: providerName }
            )}
          >
            <label className="toggle">
              <input type="checkbox" checked={reply.enabled} onChange={e => set({ enabled: e.target.checked })} />{' '}
              {t('Abwesenheitsnotiz aktiv')}
            </label>
            <div className="managed-field-grid">
              <label>
                {provider === 'microsoft' ? t('Von') : t('Von (optional)')}
                <input type="date" value={reply.start} onChange={e => set({ start: e.target.value })} />
              </label>
              <label>
                {provider === 'microsoft' ? t('Bis') : t('Bis (optional)')}
                <input type="date" value={reply.end} onChange={e => set({ end: e.target.value })} />
              </label>
              {provider === 'google' && (
                <label>
                  {t('Betreff')}
                  <input
                    value={reply.subject}
                    maxLength={200}
                    placeholder={t('Abwesend')}
                    onChange={e => set({ subject: e.target.value })}
                  />
                </label>
              )}
              <label>
                {t('Antworten an')}
                <select value={reply.audience} onChange={e => set({ audience: e.target.value as Reply['audience'] })}>
                  <option value="all">{t('Alle Absender')}</option>
                  <option value="contacts">{t('Nur meine Kontakte')}</option>
                  <option value="internal">{t('Nur meine Organisation')}</option>
                </select>
              </label>
            </div>
            {provider === 'microsoft' && (
              <p className="managed-hint">
                {t(
                  'Ohne Datum gilt die Notiz, bis du sie ausschaltest. Microsoft setzt den Betreff selbst („Automatische Antwort: …“) und antwortet jedem Absender einmal.'
                )}
              </p>
            )}
            {provider === 'google' && (
              <p className="managed-hint">{t('Gmail antwortet jedem Absender höchstens einmal in vier Tagen.')}</p>
            )}
            <fieldset className="identity-section">
              <legend>{t('Text')}</legend>
              <RichTextField
                label={t('Text der Abwesenheitsnotiz')}
                value={reply.bodyHtml}
                onChange={html => set({ bodyHtml: html })}
              />
            </fieldset>
            <label className="toggle">
              <input
                type="checkbox"
                checked={reply.includeSignature}
                onChange={e => set({ includeSignature: e.target.checked })}
              />{' '}
              {t('Signatur des Kontos anhängen')}
            </label>
            <p className="managed-hint">
              {t(
                '{provider} speichert die Notiz formatiert (fett, Links), aber ohne eingebettete Bilder: Ein hochgeladenes Logo (auch aus der Signatur) wird weggelassen. Die Signatur wird beim Speichern übernommen – nach einer Änderung an der Signatur bitte hier erneut speichern.',
                { provider: providerName }
              )}
            </p>
          </Section>
          <div className="settings-sticky-actions">
            {!dirty && (
              <small className="ok-text">
                <Check size={13} /> {t('Gespeichert')}
              </small>
            )}
            <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}{' '}
              {t('Bei {provider} speichern', { provider: providerName })}
            </button>
          </div>
        </>
      )}
    </>
  );
}
