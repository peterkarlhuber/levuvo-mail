import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileKey2, KeyRound, Lock, Plus, ShieldCheck, Trash2, Unlock, Upload } from 'lucide-react';
import { download, fileToBase64, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Section } from './Settings';
import type { ApiStatus, AccountItem } from './types';

type PgpKey = {
  fingerprint: string;
  userIds: string[];
  emails: string[];
  created: string;
  expires: string | null;
  algorithm: string;
  unlocked?: boolean;
  hasSecret?: boolean;
};
type Cert = {
  id: string;
  subject: string;
  issuer: string;
  emails: string[];
  notBefore: string;
  notAfter: string;
  hasSecret?: boolean;
};
type CryptoState = {
  vaultAvailable: boolean;
  pgp: { own: PgpKey[]; public: PgpKey[] };
  smime: { own: Cert[]; public: Cert[]; trusted: Cert[] };
};

const fp = (f: string) => f.replace(/(.{4})/g, '$1 ').trim();

export function SecuritySettings() {
  const { t, locale } = useT();
  const { confirm, prompt, toast } = useUi();
  const [state, setState] = useState<CryptoState | null>(null);
  const [own, setOwn] = useState<{ email: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const pgpFile = useRef<HTMLInputElement>(null);
  const p12File = useRef<HTMLInputElement>(null);
  const certFile = useRef<HTMLInputElement>(null);
  const trustFile = useRef<HTMLInputElement>(null);
  const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(locale) : '–');

  const load = useCallback(
    () =>
      getJson<CryptoState>('/api/crypto')
        .then(setState)
        .catch(e => toast({ text: (e as Error).message, kind: 'error' })),
    [toast]
  );
  useEffect(() => {
    void load();
    void getJson<{ accounts: AccountItem[] }>('/api/accounts')
      .then(async d => {
        const list = await Promise.all(
          d.accounts.filter(a => a.configured).map(a => getJson<ApiStatus>('/api/status', a.id).catch(() => null))
        );
        setOwn(list.flatMap(s => s?.identities || []).map(i => ({ email: i.email, name: i.name })));
      })
      .catch(() => {});
  }, [load]);

  async function run<T>(fn: () => Promise<T>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast({ text: success, kind: 'success' });
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    const email =
      own.length === 1
        ? own[0].email
        : await prompt({
            title: t('Schlüssel erzeugen'),
            message: t('Für welche deiner Adressen? ({list})', { list: own.map(o => o.email).join(', ') }),
            label: t('E-Mail-Adresse'),
            value: own[0]?.email || '',
            validate: v =>
              own.some(o => o.email === v.trim().toLowerCase()) ? null : t('Nur eigene Absenderadressen.')
          });
    if (!email) return;
    const pass = await prompt({
      title: t('Passphrase festlegen'),
      message: t(
        'Schützt deinen privaten Schlüssel. Ohne Passphrase kannst du verschlüsselte Nachrichten nicht mehr lesen – sicher aufbewahren!'
      ),
      label: t('Passphrase (mind. 8 Zeichen)'),
      type: 'password',
      validate: v => (v.length >= 8 ? null : t('Mindestens 8 Zeichen.'))
    });
    if (!pass) return;
    const again = await prompt({
      title: t('Passphrase wiederholen'),
      label: t('Passphrase'),
      type: 'password',
      validate: v => (v === pass ? null : t('Stimmt nicht überein.'))
    });
    if (!again) return;
    const name = own.find(o => o.email === email.trim().toLowerCase())?.name || '';
    await run(
      () =>
        postJson(
          '/api/crypto/pgp/generate',
          { email: email.trim().toLowerCase(), name, passphrase: pass },
          'crypto-v1'
        ),
      t('Schlüssel erzeugt (Curve25519).')
    );
  }
  async function importPgp(file?: File) {
    if (!file) return;
    const armored = await file.text();
    let passphrase = '';
    if (armored.includes('PRIVATE KEY')) {
      const p = await prompt({
        title: t('Privaten Schlüssel importieren'),
        message: t(
          'Passphrase des Schlüssels. Ist er ungeschützt, wird er mit dieser Passphrase geschützt (mind. 8 Zeichen).'
        ),
        label: t('Passphrase'),
        type: 'password'
      });
      if (p === null) return;
      passphrase = p;
    }
    await run(
      () => postJson('/api/crypto/pgp/import', { armored, passphrase }, 'crypto-v1'),
      t('Schlüssel importiert.')
    );
  }
  async function unlock(k: PgpKey) {
    const p = await prompt({
      title: t('Schlüssel entsperren'),
      message: t('Bleibt 30 Minuten entsperrt.'),
      label: t('Passphrase'),
      type: 'password'
    });
    if (p === null) return;
    await run(
      () => postJson('/api/crypto/pgp/unlock', { fingerprint: k.fingerprint, passphrase: p }, 'crypto-v1'),
      t('Entsperrt.')
    );
  }
  async function removePgp(k: PgpKey, isOwn: boolean) {
    if (
      !(await confirm({
        title: t('Schlüssel entfernen?'),
        message: isOwn
          ? t(
              'Ohne diesen privaten Schlüssel kannst du damit verschlüsselte Nachrichten nicht mehr lesen. Vorher ein Backup anlegen!'
            )
          : t('Du kannst diesem Kontakt dann nicht mehr verschlüsselt schreiben.'),
        confirmLabel: t('Entfernen'),
        danger: true
      }))
    )
      return;
    await run(
      () => postJson('/api/crypto/pgp/remove', { fingerprint: k.fingerprint, confirm: 'REMOVE_KEY' }, 'crypto-v1'),
      t('Entfernt.')
    );
  }
  async function importP12(file?: File) {
    if (!file) return;
    const password = await prompt({
      title: t('Zertifikat importieren'),
      message: file.name,
      label: t('Passwort der .p12/.pfx-Datei'),
      type: 'password'
    });
    if (password === null) return;
    const { contentBase64 } = await fileToBase64(file);
    await run(
      () => postJson('/api/crypto/smime/import-p12', { p12: contentBase64, password }, 'crypto-v1'),
      t('Zertifikat importiert.')
    );
  }
  async function importCert(file: File | undefined, trust: boolean) {
    if (!file) return;
    const raw = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(raw);
    const pem = text.includes('BEGIN CERTIFICATE')
      ? text
      : `-----BEGIN CERTIFICATE-----\n${btoa(String.fromCharCode(...raw)).replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;
    if (
      trust &&
      !(await confirm({
        title: t('Zertifizierungsstelle vertrauen?'),
        message: t(
          'Nur Stammzertifikate deiner Organisation hinzufügen. Signaturen dieser Stelle gelten danach als vertrauenswürdig.'
        ),
        confirmLabel: t('Vertrauen')
      }))
    )
      return;
    await run(
      () => postJson('/api/crypto/smime/import-cert', { pem, trust }, 'crypto-v1'),
      t('Zertifikat importiert.')
    );
  }
  async function removeCert(c: Cert) {
    if (
      !(await confirm({
        title: t('Zertifikat entfernen?'),
        message: c.subject,
        confirmLabel: t('Entfernen'),
        danger: true
      }))
    )
      return;
    await run(
      () => postJson('/api/crypto/smime/remove', { id: c.id, confirm: 'REMOVE_KEY' }, 'crypto-v1'),
      t('Entfernt.')
    );
  }

  if (!state) return null;
  const pgpRow = (k: PgpKey, isOwn: boolean) => (
    <div className="key-row" key={k.fingerprint}>
      <KeyRound size={16} />
      <span>
        <strong>{k.emails.join(', ') || k.userIds[0]}</strong>
        <small title={k.fingerprint}>
          {fp(k.fingerprint)} · {k.algorithm} · {t('erstellt {date}', { date: date(k.created) })}
          {k.expires ? ` · ${t('gültig bis {date}', { date: date(k.expires) })}` : ''}
        </small>
      </span>
      {isOwn &&
        k.hasSecret &&
        (k.unlocked ? (
          <button
            className="btn small"
            disabled={busy}
            onClick={() => void run(() => postJson('/api/crypto/pgp/lock', {}, 'crypto-v1'), t('Gesperrt.'))}
          >
            <Lock size={13} /> {t('Sperren')}
          </button>
        ) : (
          <button className="btn small" disabled={busy} onClick={() => void unlock(k)}>
            <Unlock size={13} /> {t('Entsperren')}
          </button>
        ))}
      <button
        className="icon-button"
        title={t('Öffentlichen Schlüssel exportieren')}
        aria-label={t('Öffentlichen Schlüssel exportieren')}
        onClick={() => download(`/api/crypto/pgp/export?fingerprint=${k.fingerprint}`)}
      >
        <Download size={15} />
      </button>
      <button
        className="icon-button"
        title={t('Entfernen')}
        aria-label={t('Entfernen')}
        disabled={busy}
        onClick={() => void removePgp(k, isOwn)}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
  const certRow = (c: Cert, removable = true) => (
    <div className="key-row" key={c.id}>
      <FileKey2 size={16} />
      <span>
        <strong>{c.emails.join(', ') || c.subject}</strong>
        <small>
          {c.subject} · {t('ausgestellt von {issuer}', { issuer: c.issuer })} ·{' '}
          {t('gültig bis {date}', { date: date(c.notAfter) })}
          {new Date(c.notAfter).getTime() < Date.now() ? ` · ${t('abgelaufen')}` : ''}
        </small>
      </span>
      {removable && (
        <button
          className="icon-button"
          title={t('Entfernen')}
          aria-label={t('Entfernen')}
          disabled={busy}
          onClick={() => void removeCert(c)}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {!state.vaultAvailable && (
        <p className="compose-warning">
          {t('Der Schlüsselbund ist nicht verfügbar – private Schlüssel können nicht gespeichert werden.')}
        </p>
      )}
      <Section
        title="OpenPGP"
        description={t(
          'Ende-zu-Ende-Verschlüsselung nach OpenPGP (kompatibel mit Thunderbird, GnuPG, Proton u. a.). Private Schlüssel liegen passphrasegeschützt im Schlüsselbund.'
        )}
      >
        <h4>{t('Eigene Schlüssel')}</h4>
        {state.pgp.own.length === 0 && <p className="muted">{t('Noch kein eigener Schlüssel.')}</p>}
        {state.pgp.own.map(k => pgpRow(k, true))}
        <h4>{t('Schlüssel von Kontakten')}</h4>
        {state.pgp.public.length === 0 && (
          <p className="muted">
            {t('Noch keine. Öffentliche Schlüssel kannst du hier oder direkt aus einer E-Mail importieren.')}
          </p>
        )}
        {state.pgp.public.map(k => pgpRow(k, false))}
        <div className="settings-actions">
          <button className="btn small" disabled={busy || !own.length} onClick={() => void generate()}>
            <Plus size={14} /> {t('Schlüssel erzeugen')}
          </button>
          <button className="btn small" disabled={busy} onClick={() => pgpFile.current?.click()}>
            <Upload size={14} /> {t('Schlüssel importieren (.asc)')}
          </button>
          <input
            ref={pgpFile}
            type="file"
            accept=".asc,.gpg,.pgp,.key,text/plain,application/pgp-keys"
            hidden
            onChange={e => {
              void importPgp(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </Section>
      <Section
        title="S/MIME"
        description={t(
          'Zertifikatsbasierte Signatur und Verschlüsselung (Standard in Outlook/Apple Mail). Dein Zertifikat erhältst du von einer Zertifizierungsstelle als .p12/.pfx-Datei.'
        )}
      >
        <h4>{t('Eigene Zertifikate')}</h4>
        {state.smime.own.length === 0 && <p className="muted">{t('Noch kein eigenes Zertifikat.')}</p>}
        {state.smime.own.map(c => certRow(c))}
        <h4>{t('Zertifikate von Kontakten')}</h4>
        {state.smime.public.length === 0 && (
          <p className="muted">{t('Werden automatisch aus signierten E-Mails übernommen.')}</p>
        )}
        {state.smime.public.map(c => certRow(c))}
        {state.smime.trusted.length > 0 && (
          <>
            <h4>{t('Zusätzlich vertraute Zertifizierungsstellen')}</h4>
            {state.smime.trusted.map(c => certRow(c, false))}
          </>
        )}
        <div className="settings-actions">
          <button className="btn small" disabled={busy} onClick={() => p12File.current?.click()}>
            <Upload size={14} /> {t('Eigenes Zertifikat (.p12/.pfx)')}
          </button>
          <button className="btn small" disabled={busy} onClick={() => certFile.current?.click()}>
            <Upload size={14} /> {t('Zertifikat eines Kontakts (.cer/.pem)')}
          </button>
          <button className="btn small" disabled={busy} onClick={() => trustFile.current?.click()}>
            <ShieldCheck size={14} /> {t('Zertifizierungsstelle vertrauen')}
          </button>
          <input
            ref={p12File}
            type="file"
            accept=".p12,.pfx,application/x-pkcs12"
            hidden
            onChange={e => {
              void importP12(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={certFile}
            type="file"
            accept=".cer,.crt,.pem,.der"
            hidden
            onChange={e => {
              void importCert(e.target.files?.[0], false);
              e.target.value = '';
            }}
          />
          <input
            ref={trustFile}
            type="file"
            accept=".cer,.crt,.pem,.der"
            hidden
            onChange={e => {
              void importCert(e.target.files?.[0], true);
              e.target.value = '';
            }}
          />
        </div>
      </Section>
    </>
  );
}
