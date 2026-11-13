import { CalendarCheck2 } from 'lucide-react';
import { useOAuthSignIn } from './AccountSettings';
import { useT } from './i18n';

export type CloudError = {
  accountId?: string;
  accountLabel?: string;
  provider?: string;
  code?: string;
  error: string;
  calendar?: string;
};

export const isConsentError = (e: CloudError) => e.code === 'cloud_consent_required' && Boolean(e.provider);

/**
 * Microsoft 365 / Google accounts signed in before 2.1 have not yet allowed calendar and
 * contacts access. One click opens the provider's consent page for exactly this account.
 */
export function CloudConsentBanner({ errors, onDone }: { errors: CloudError[]; onDone: () => Promise<void> | void }) {
  const { t } = useT();
  const oauth = useOAuthSignIn(async () => {
    await onDone();
  });
  const pending = [...new Map(errors.filter(isConsentError).map(e => [e.accountId, e])).values()];
  if (!pending.length) return null;
  return (
    <div className="consent-banner" role="status">
      <CalendarCheck2 size={20} aria-hidden="true" />
      <div className="consent-text">
        <strong>{t('Kalender & Kontakte verbinden')}</strong>
        <span>
          {t('Für {accounts} ist noch eine einmalige Freigabe beim Anbieter nötig.', {
            accounts: pending.map(e => e.accountLabel || e.provider).join(', ')
          })}
        </span>
        {oauth.error && <span className="consent-error">{oauth.error}</span>}
      </div>
      <div className="consent-actions">
        {pending.map(e => (
          <button
            key={e.accountId}
            type="button"
            className="btn primary small"
            disabled={oauth.busy}
            onClick={() => void oauth.start(e.provider!, e.accountId)}
          >
            {oauth.busy && oauth.provider === e.provider
              ? t('Warte auf Freigabe …')
              : pending.length > 1
                ? t('{account} freigeben', { account: e.accountLabel || e.provider || '' })
                : t('Freigeben')}
          </button>
        ))}
        {oauth.busy && (
          <button type="button" className="btn ghost small" onClick={oauth.cancel}>
            {t('Abbrechen')}
          </button>
        )}
      </div>
    </div>
  );
}
