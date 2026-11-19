// Settings → About: security support (CRA Art. 13(19), Annex II) and the open-source licences of
// everything that ships (npm, AI runtime, Ollama). Server side: routes-data-rights.mjs.
import { useEffect, useState } from 'react';
import { getJson } from './api';
import { useT } from './i18n';
import { Section } from './Settings';
import { Dialog } from './ui';

type Legal = { version: string; supportUntil: string; notices: { id: string; title: string }[] };

export function AboutCompliance() {
  const { t, locale } = useT();
  const [legal, setLegal] = useState<Legal | null>(null);
  const [open, setOpen] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => {
    void getJson<Legal>('/api/runtime/legal')
      .then(setLegal)
      .catch(() => {});
  }, []);

  async function show(id: string, title: string) {
    setOpen({ title, text: t('Lizenztexte werden geladen …') });
    try {
      const res = await fetch(`/api/runtime/legal/${encodeURIComponent(id)}`, { cache: 'no-store' });
      setOpen({ title, text: res.ok ? await res.text() : t('Nicht Teil dieser Installation.') });
    } catch {
      setOpen({ title, text: t('Nicht Teil dieser Installation.') });
    }
  }

  const until = legal?.supportUntil
    ? new Date(`${legal.supportUntil}T12:00:00Z`).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })
    : '';

  return (
    <>
      <Section title={t('Sicherheit und Support')}>
        {until && (
          <p className="settings-description">
            {t('Sicherheitsupdates für diese Version bis {date}, kostenlos.', { date: until })}
          </p>
        )}
        <p className="settings-description">
          {t(
            'Sicherheitslücke melden: über „Report a vulnerability“ im GitHub-Repository von Levuvo Mail oder an die Sicherheitsadresse auf levuvo.at. Details in SECURITY.md.'
          )}
        </p>
        <p className="settings-description">
          {t(
            'Jede Version hat eine Software-Stückliste (SBOM, CycloneDX) und eine Liste aller Lizenzen; beide liegen dem Release bei.'
          )}
        </p>
      </Section>
      <Section title={t('Open-Source-Lizenzen')}>
        <p className="settings-description">
          {t(
            'Levuvo Mail verwendet Open-Source-Komponenten, u. a. Electron, React, Fastify, ImapFlow, Nodemailer, OpenPGP.js, PKI.js, ical.js, tsdav, TipTap, Lucide, Python, Orkexa und Ollama. Die Lizenzen der Modelle stehen in der Modellliste unter „KI & Agenten“.'
          )}
        </p>
        {legal?.notices?.length ? (
          <div className="settings-actions">
            {legal.notices.map(n => (
              <button key={n.id} className="btn small" onClick={() => void show(n.id, n.title)}>
                {t('Anzeigen')}: {n.title}
              </button>
            ))}
          </div>
        ) : null}
      </Section>
      {open && (
        <Dialog title={open.title} onClose={() => setOpen(null)} size="lg">
          <pre className="license-text" tabIndex={0}>
            {open.text}
          </pre>
        </Dialog>
      )}
    </>
  );
}
