// Settings → AI & agents → Writing style: the writing style learned per contact (opt-in). Shows what
// was learned (greeting, closing, du/Sie) for each contact and lets the user relearn or delete it.
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, IconButton } from './ui';
import { Row, Toggle } from './Settings';
import { dateLabel } from './format';

type Habit = {
  greeting: string;
  closing: string;
  address: '' | 'du' | 'sie';
  words: number;
  count: number;
  last: string;
};
type AccountStyle = {
  accountId: string;
  label: string;
  builtAt: string | null;
  mails: number;
  overall: Habit | null;
  contacts: (Habit & { email: string })[];
};
type StyleState = { enabled: boolean; persistent: boolean; accounts: AccountStyle[] };

const SHOWN = 30;

export function StyleProfileSettings({ onToggle }: { onToggle: (on: boolean) => Promise<void> }) {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [state, setState] = useState<StyleState | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(
    () =>
      getJson<StyleState>('/api/ai/style')
        .then(setState)
        .catch(() => setState(null)),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(on: boolean) {
    if (!on) {
      const ok = await confirm({
        title: t('Stil lernen ausschalten?'),
        message: t(
          'Der gelernte Stil aller Kontakte wird gelöscht. Antwortvorschläge nutzen dann nur noch deine Einstellungen und die letzten gesendeten Mails.'
        ),
        confirmLabel: t('Ausschalten und löschen'),
        danger: true
      });
      if (!ok) return;
    }
    await run(async () => {
      await onToggle(on);
      // Learning runs in the background after switching on; show it once it has run.
      if (on) await postJson('/api/ai/style/learn', {}, 'ai-v1');
    });
  }

  const addressLabel = (a: Habit['address']) => (a === 'du' ? t('Du-Form') : a === 'sie' ? t('Sie-Form') : '–');
  const enabled = Boolean(state?.enabled);
  return (
    <>
      <Row
        label={t('Stil pro Kontakt lernen')}
        hint={t(
          'Levuvo Mail liest deine gesendeten Mails im lokalen Suchindex und merkt sich je Kontakt Anrede, Gruß und Du oder Sie. Ohne KI-Modell, nur auf diesem Gerät, verschlüsselt, nicht im Backup. Mit einem Cloud-Modell gehen bei Antwortvorschlägen die Gewohnheiten und bis zu fünf deiner Mails an diesen Kontakt mit.'
        )}
      >
        <Toggle label={t('Stil pro Kontakt lernen')} checked={enabled} onChange={v => void toggle(v)} />
      </Row>
      {enabled && state && (
        <div className="style-profile">
          {!state.persistent && (
            <p className="ai-hint">
              {t('Ohne Schlüsselbund wird der gelernte Stil nur bis zum Beenden der App gehalten.')}
            </p>
          )}
          <div className="style-profile-actions">
            <Button
              size="sm"
              icon={busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCcw size={14} />}
              disabled={busy}
              onClick={() => void run(() => postJson('/api/ai/style/learn', {}, 'ai-v1'))}
            >
              {t('Jetzt neu lernen')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={14} />}
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: t('Gelernten Stil löschen?'),
                  message: t('Der gelernte Stil aller Kontakte wird gelöscht. Beim nächsten Lernen entsteht er neu.'),
                  confirmLabel: t('Löschen'),
                  danger: true
                });
                if (ok) void run(() => postJson('/api/ai/style/clear', {}, 'ai-v1'));
              }}
            >
              {t('Gelernten Stil löschen')}
            </Button>
            <input
              type="search"
              className="style-profile-filter"
              placeholder={t('Kontakt suchen …')}
              aria-label={t('Kontakt suchen …')}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          {state.accounts.map(a => {
            const list = a.contacts.filter(c => !filter || c.email.includes(filter.trim().toLowerCase()));
            return (
              <section key={a.accountId} className="style-profile-account" aria-label={a.label}>
                <h3>{a.label}</h3>
                <p className="ai-hint">
                  {a.builtAt
                    ? t('Gelernt aus {mails} gesendeten Mails an {contacts} Kontakte, zuletzt {when}.', {
                        mails: a.mails,
                        contacts: a.contacts.length,
                        when: dateLabel(a.builtAt)
                      })
                    : t('Noch nichts gelernt. Der Suchindex muss eingeschaltet sein und gesendete Mails enthalten.')}
                  {a.overall?.greeting &&
                    ' ' +
                      t('Meist: „{greeting}“ … „{closing}“.', {
                        greeting: a.overall.greeting,
                        closing: a.overall.closing || '–'
                      })}
                </p>
                {list.length > 0 && (
                  <table className="style-profile-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('Kontakt')}</th>
                        <th scope="col">{t('Anrede')}</th>
                        <th scope="col">{t('Gruß')}</th>
                        <th scope="col">{t('Du/Sie')}</th>
                        <th scope="col">{t('Mails')}</th>
                        <th scope="col">
                          <span className="sr-only">{t('Löschen')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.slice(0, SHOWN).map(c => (
                        <tr key={c.email}>
                          <td>{c.email}</td>
                          <td>{c.greeting || '–'}</td>
                          <td>{c.closing || '–'}</td>
                          <td>{addressLabel(c.address)}</td>
                          <td>{c.count}</td>
                          <td>
                            <IconButton
                              size="sm"
                              label={t('Stil für {email} löschen', { email: c.email })}
                              icon={<Trash2 size={13} />}
                              onClick={() =>
                                void run(() =>
                                  postJson('/api/ai/style/remove', { account: a.accountId, contact: c.email }, 'ai-v1')
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {list.length > SHOWN && (
                  <p className="ai-hint">
                    {t('Weitere {count} Kontakte, über die Suche zu finden.', { count: list.length - SHOWN })}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
