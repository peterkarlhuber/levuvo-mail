// Open polls and offers sent from "Termin finden": who answered which time, and the button that
// fixes the time (the event is entered and everyone gets an invitation).
import { useEffect, useState } from 'react';
import { CalendarCheck, LoaderCircle, Trash2, XCircle } from 'lucide-react';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, Dialog } from './ui';
import { scheduling, slotText, type Poll } from './scheduling-api';

export function SchedulingPollsDialog({ onClose, onBooked }: { onClose: () => void; onBooked: () => void }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = () =>
    scheduling
      .list()
      .then(r => setPolls(r.polls || []))
      .catch(() => setPolls([]));
  useEffect(() => {
    void load();
  }, []);

  async function book(p: Poll, n: number) {
    if (
      !(await confirm({
        title: t('Termin festlegen?'),
        message: t('„{title}“ am {when} wird eingetragen, und alle {count} Personen bekommen eine Einladung.', {
          title: p.title,
          when: slotText(p.slots[n - 1], locale),
          count: p.participants.length
        }),
        confirmLabel: t('Festlegen und einladen')
      }))
    )
      return;
    setBusy(p.id);
    try {
      await scheduling.book(p.id, n);
      toast({ text: t('Termin eingetragen, Einladungen gesendet.'), kind: 'success' });
      onBooked();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
      void load();
    }
  }
  const status = {
    open: t('offen'),
    booked: t('festgelegt'),
    cancelled: t('beendet'),
    expired: t('abgelaufen')
  };

  return (
    <Dialog title={t('Abstimmungen')} onClose={onClose} size="lg" className="polls-dialog">
      {!polls && (
        <p className="muted">
          <LoaderCircle size={14} className="spin" /> {t('Lädt …')}
        </p>
      )}
      {polls?.length === 0 && <p className="muted">{t('Noch keine Abstimmung. Starte eine über „Termin finden“.')}</p>}
      {polls?.map(p => {
        const answered = Object.keys(p.votes).length;
        return (
          <section key={p.id} className={`poll-card ${p.status}`}>
            <header>
              <h3>{p.title}</h3>
              <span className="poll-status">
                {p.kind === 'offer' ? t('Angebot') : t('Abstimmung')} · {status[p.status]}
              </span>
              <span className="poll-tools">
                {p.status === 'open' && (
                  <button
                    className="icon-button"
                    aria-label={t('Abstimmung beenden')}
                    title={t('Abstimmung beenden')}
                    onClick={async () => {
                      await scheduling.cancel(p.id).catch(() => {});
                      void load();
                    }}
                  >
                    <XCircle size={14} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={t('Abstimmung löschen')}
                  title={t('Abstimmung löschen')}
                  onClick={async () => {
                    await scheduling.remove(p.id).catch(() => {});
                    void load();
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </header>
            <p className="muted">
              {p.kind === 'poll'
                ? t('{answered} von {count} haben geantwortet.', { answered, count: p.participants.length })
                : p.booked
                  ? t('Gebucht von {who}.', { who: p.booked.by || '' })
                  : t('Wartet, bis jemand eine Zeit wählt.')}
              {p.none.length > 0 && <> {t('Keine Zeit passt: {who}', { who: p.none.join(', ') })}</>}
            </p>
            <ol className="poll-slots">
              {p.slots.map((s, i) => {
                const yes = p.counts[i] || [];
                const isBooked = p.booked?.slot === i + 1;
                return (
                  <li key={s.start} className={isBooked ? 'booked' : ''}>
                    <span className="slot-time">{slotText(s, locale)}</span>
                    {p.kind === 'poll' && (
                      <span className="poll-yes" title={yes.join(', ')}>
                        <meter min={0} max={Math.max(1, p.participants.length)} value={yes.length} aria-hidden="true" />
                        {t('{count} passt', { count: yes.length })}
                      </span>
                    )}
                    {isBooked && <strong>{t('festgelegt')}</strong>}
                    {p.status === 'open' && p.kind === 'poll' && (
                      <Button
                        size="sm"
                        icon={<CalendarCheck size={13} />}
                        busy={busy === p.id}
                        onClick={() => void book(p, i + 1)}
                      >
                        {t('Festlegen')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </Dialog>
  );
}
