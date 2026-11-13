import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { EXTENSIONS, htmlToPlain, normalize, plainToHtml, SIGNATURE_SEPARATOR, Toolbar } from './editor';
import {
  BellRing,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Lock,
  Paperclip,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import { fileToBase64, fileToDataUrl, getJson, postJson, ApiError } from './api';
import { fillTemplate, nameParts, type Template, type TemplateVars } from './templates';
import TemplateMenu from './TemplateMenu';
import { useUi } from './ConfirmDialog';
import RecipientInput from './RecipientInput';
import { useT } from './i18n';
import WhenMenu from './WhenMenu';
import { FOLLOW_UP_DAYS } from './when';
import { usePrefs } from './prefs';
import type { Identity } from './types';

export type ComposeInitial = {
  mode: 'new' | 'reply' | 'replyAll' | 'forward';
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  html?: string;
  text?: string;
  format?: 'html' | 'text';
  from?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: File[];
  notice?: string;
  draftId?: string;
  draftUid?: number;
  draftUidValidity?: string;
  security?: Security;
  scheduledFor?: string;
};
export type Security = {
  method: 'pgp' | 'smime' | 'password' | null;
  sign: boolean;
  encrypt: boolean;
  /** Only for method 'password': never stored, only sent with the message. */
  password?: string;
  hint?: string;
};

/** Strong, readable password: 4 groups of 4 without look-alike characters (≈ 95 bit). */
export function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  const chars = Array.from(bytes, b => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map(i => chars.slice(i, i + 4).join('')).join('-');
}
export type OutgoingPayload = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  inReplyTo?: string;
  references?: string;
  attachments: { name: string; contentBase64: string }[];
  security: Security;
  replaceDraft?: { uid: number; uidValidity: string; draftId: string };
  followUp?: string;
};

type Props = {
  accountId: string;
  initial: ComposeInitial;
  identities: Identity[];
  sendEnabled: boolean;
  draftsEnabled: boolean;
  onClose: () => void;
  /** Hand-off for "send" (with undo delay) or schedule. The composer closes afterwards. */
  onSubmit: (payload: OutgoingPayload, restore: ComposeInitial, sendAt: string | null) => void;
};

const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 1024 * 1024;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const parseAddresses = (value: string) => (value.trim() ? value.split(/[;,\s]+/).filter(Boolean) : []);
const prettySize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
export default function Composer({
  accountId,
  initial,
  identities,
  sendEnabled,
  draftsEnabled,
  onClose,
  onSubmit
}: Props) {
  const { t, locale } = useT();
  const { confirm, prompt, toast } = useUi();
  const [prefs] = usePrefs();
  const [from, setFrom] = useState(initial.from || identities[0]?.email || '');
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc);
  const [bcc, setBcc] = useState(initial.bcc);
  const [showCopies, setShowCopies] = useState(Boolean(initial.cc || initial.bcc));
  const [subject, setSubject] = useState(initial.subject);
  const [format, setFormat] = useState<'html' | 'text'>(initial.format || prefs.composeMode);
  const [text, setText] = useState(initial.text ?? (initial.html ? htmlToPlain(initial.html) : ''));
  const [htmlVersion, setHtmlVersion] = useState(0);
  const [files, setFiles] = useState<File[]>(initial.attachments || []);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const [security, setSecurity] = useState<Security>(initial.security || { method: null, sign: false, encrypt: false });
  const [missing, setMissing] = useState<{ recipients: string[]; own: boolean } | null>(null);
  const [error, setError] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [followUpDays, setFollowUpDays] = useState(0);
  const draftId = useRef(initial.draftId || crypto.randomUUID());
  const draftMeta = useRef<{ uid: number | null; uidValidity: string | null }>({
    uid: initial.draftUid ?? null,
    uidValidity: initial.draftUidValidity ?? null
  });
  const saving = useRef(false);
  const pending = useRef(false);
  const uncertain = useRef(false);
  const [saveTick, setSaveTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'uncertain'>(
    initial.draftUid ? 'saved' : 'idle'
  );

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial.html || plainToHtml(initial.text || ''),
    editorProps: {
      attributes: { class: 'compose-editor', 'aria-label': t('Nachricht') },
      handleDrop: (_view, event) => Boolean(event.dataTransfer?.files?.length)
    },
    onUpdate: () => setHtmlVersion(v => v + 1)
  });

  const html = useMemo(() => (editor ? editor.getHTML() : ''), [editor, htmlVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const toList = parseAddresses(to);
  const ccList = parseAddresses(cc);
  const bccList = parseAddresses(bcc);
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const body = format === 'html' ? html : text;
  const signature = JSON.stringify([
    from,
    to,
    cc,
    bcc,
    subject,
    format,
    body,
    files.map(f => `${f.name}:${f.size}`).join('|'),
    security
  ]);
  const savedSignature = useRef(signature);
  // Baseline once the editor has rendered the initial content (its HTML is normalized).
  const baseline = useRef(false);
  if (!baseline.current && (editor || format === 'text')) {
    baseline.current = true;
    savedSignature.current = signature;
  }
  const changed = signature !== savedSignature.current;
  const identity = identities.find(i => i.email === from);

  // Signature follows the chosen sender (HTML mode); in text mode the user edits freely.
  const lastFrom = useRef(from);
  useEffect(() => {
    if (lastFrom.current === from) return;
    const prev = identities.find(i => i.email === lastFrom.current)?.signatureHtml || '';
    const next = identity?.signatureHtml || '';
    lastFrom.current = from;
    if (format === 'text') {
      const p = prev ? htmlToPlain(prev) : '';
      const n = next ? htmlToPlain(next) : '';
      setText(old => (p && old.includes(p) ? old.replace(p, n) : !p && n ? `${old}\n\n-- \n${n}` : old));
      return;
    }
    if (!editor) return;
    const current = editor.getHTML();
    const p = normalize(prev);
    const n = normalize(next);
    if (p && current.includes(p)) editor.commands.setContent(current.replace(p, n));
    else if (!p && n)
      editor.commands.setContent(`${current}${current.includes(SIGNATURE_SEPARATOR) ? '' : SIGNATURE_SEPARATOR}${n}`);
  }, [from, editor, identities, identity, format]);

  // Missing keys/certificates for end-to-end protection.
  useEffect(() => {
    if (!security.method || security.method === 'password' || (!security.sign && !security.encrypt)) {
      setMissing(null);
      return;
    }
    const recipients = [...toList, ...ccList, ...bccList].filter(a => EMAIL.test(a));
    const timer = window.setTimeout(async () => {
      try {
        if (security.method === 'pgp') {
          const r = await postJson<{ missing: string[] }>(
            '/api/crypto/pgp/missing',
            { emails: security.encrypt ? recipients : [] },
            'crypto-v1'
          );
          const crypto = await fetch('/api/crypto').then(x => x.json());
          const own = (crypto.pgp?.own || []).some((k: { emails: string[] }) => k.emails.includes(from.toLowerCase()));
          setMissing({ recipients: r.missing, own: (security.sign || security.encrypt) && !own });
        } else {
          const r = await postJson<{ missing: string[]; own: boolean }>(
            '/api/crypto/smime/missing',
            { emails: security.encrypt ? recipients : [], from },
            'crypto-v1'
          );
          setMissing({ recipients: r.missing, own: !r.own });
        }
      } catch {
        setMissing(null);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [security, to, cc, bcc, from]); // eslint-disable-line react-hooks/exhaustive-deps

  const payloadBase = useCallback(
    async (): Promise<OutgoingPayload> => ({
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      from,
      ...(format === 'html' ? { html } : { text }),
      inReplyTo: initial.inReplyTo,
      references: initial.references,
      attachments: await Promise.all(files.map(fileToBase64)),
      security,
      ...(draftMeta.current.uid && draftMeta.current.uidValidity
        ? {
            replaceDraft: {
              uid: draftMeta.current.uid,
              uidValidity: draftMeta.current.uidValidity,
              draftId: draftId.current
            }
          }
        : {})
    }),
    [toList, ccList, bccList, subject, from, format, html, text, initial.inReplyTo, initial.references, files, security]
  );

  const saveDraft = useCallback(
    async (sig: string) => {
      if (!draftsEnabled || saving.current || uncertain.current) {
        if (saving.current) pending.current = true;
        return;
      }
      saving.current = true;
      setSaveStatus('saving');
      try {
        const base = await payloadBase();
        const saved = await postJson<{ uid: number; uidValidity: string; previousRemoved: boolean }>(
          '/api/drafts/save',
          {
            draftId: draftId.current,
            previousUid: draftMeta.current.uid,
            uidValidity: draftMeta.current.uidValidity,
            to: base.to.filter(a => EMAIL.test(a)),
            cc: base.cc.filter(a => EMAIL.test(a)),
            bcc: base.bcc.filter(a => EMAIL.test(a)),
            subject,
            html: base.html,
            text: base.text,
            from,
            inReplyTo: initial.inReplyTo || null,
            attachments: base.attachments
          },
          'draft-v1',
          accountId
        );
        draftMeta.current = { uid: saved.uid, uidValidity: saved.uidValidity };
        savedSignature.current = sig;
        setSaveStatus('saved');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'draft_save_uncertain') uncertain.current = true;
        setSaveStatus(uncertain.current ? 'uncertain' : 'error');
      } finally {
        saving.current = false;
        if (pending.current) {
          pending.current = false;
          setSaveTick(n => n + 1);
        }
      }
    },
    [draftsEnabled, payloadBase, subject, from, initial.inReplyTo, accountId]
  );

  useEffect(() => {
    if (!draftsEnabled || !changed || uncertain.current) return;
    const timer = window.setTimeout(() => void saveDraft(signature), 3000);
    return () => window.clearTimeout(timer);
  }, [signature, changed, draftsEnabled, saveTick, saveDraft]);

  // A scheduled message that is opened for editing is unscheduled right away (stored
  // as a normal draft), so it cannot go out while it is being changed.
  const unscheduled = useRef(false);
  useEffect(() => {
    if (!initial.scheduledFor || unscheduled.current || !draftsEnabled) return;
    unscheduled.current = true;
    void saveDraft(signature).then(() =>
      toast({ text: t('Planung aufgehoben – die Nachricht ist wieder ein Entwurf.'), kind: 'info' })
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function close() {
    if (changed && (!draftsEnabled || saving.current)) {
      const ok = await confirm({
        title: t('Nachricht verwerfen?'),
        message: t('Die Änderungen sind noch nicht als Entwurf gespeichert.'),
        confirmLabel: t('Verwerfen'),
        danger: true
      });
      if (!ok) return;
    } else if (changed && draftsEnabled) {
      await saveDraft(signature);
    }
    onClose();
  }

  function validate() {
    const all = [...toList, ...ccList, ...bccList];
    const invalid = all.find(a => !EMAIL.test(a));
    if (!toList.length) return t('Bitte mindestens einen Empfänger unter „An“ eingeben.');
    if (invalid) return t('Ungültige Adresse: {address}', { address: invalid });
    if (new Set(all.map(a => a.toLowerCase())).size > 30) return t('Maximal 30 Empfänger erlaubt.');
    const empty = format === 'html' ? !htmlToPlain(html).trim() && !/<img/i.test(html) : !text.trim();
    if (empty) return t('Bitte einen Nachrichtentext eingeben.');
    if (subject.length > 250) return t('Der Betreff ist zu lang.');
    if (files.length > MAX_ATTACHMENTS || totalBytes > MAX_TOTAL_BYTES)
      return t('Maximal acht Anhänge und insgesamt 8 MiB.');
    if (missing && (missing.own || missing.recipients.length))
      return t('Für die Verschlüsselung fehlen Schlüssel – Details oben.');
    if (security.method === 'password') {
      if ((security.password || '').length < 10) return t('Das Passwort muss mindestens 10 Zeichen lang sein.');
      if (totalBytes > 5 * 1024 * 1024) return t('Geschützte Nachrichten dürfen Anhänge bis zusammen 5 MiB enthalten.');
    }
    return '';
  }

  async function submit(sendAt: string | null) {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!subject.trim() && !(await confirm({ title: t('Ohne Betreff senden?'), confirmLabel: t('Senden') }))) return;
    setError('');
    const base = await payloadBase();
    const start = sendAt ? Date.parse(sendAt) : Date.now();
    const payload = followUpDays
      ? { ...base, followUp: new Date(start + followUpDays * 86_400_000).toISOString() }
      : base;
    const restore: ComposeInitial = {
      ...initial,
      to,
      cc,
      bcc,
      subject,
      from,
      format,
      html: format === 'html' ? html : undefined,
      text: format === 'text' ? text : undefined,
      attachments: files,
      security,
      draftId: draftId.current,
      draftUid: draftMeta.current.uid ?? undefined,
      draftUidValidity: draftMeta.current.uidValidity ?? undefined
    };
    onSubmit(payload, restore, sendAt);
  }

  async function templateVars(): Promise<TemplateVars> {
    const first = toList[0] || '';
    let parts: TemplateVars = {};
    if (first) {
      try {
        const r = await getJson<{ contacts: { email: string; name: string }[] }>(
          `/api/contacts?q=${encodeURIComponent(first)}`,
          accountId
        );
        const hit = r.contacts.find(c => c.email.toLowerCase() === first.toLowerCase());
        if (hit?.name) parts = nameParts(hit.name);
      } catch {
        /* offline: placeholders stay visible */
      }
    }
    return {
      ...parts,
      sender: identity?.name || '',
      date: new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    };
  }
  async function insertTemplate(tpl: Template) {
    const vars = await templateVars();
    if (tpl.subject && !subject.trim()) setSubject(fillTemplate(tpl.subject, vars, { html: false }));
    const body = fillTemplate(tpl.html, vars);
    if (format === 'text') {
      setText(old => `${htmlToPlain(body)}\n\n${old}`.trim());
      return;
    }
    if (!editor) return;
    const current = editor.getHTML();
    const sep = current.indexOf(SIGNATURE_SEPARATOR);
    const empty = !htmlToPlain(sep >= 0 ? current.slice(0, sep) : current).trim();
    // Empty message: template goes before the signature; otherwise at the cursor.
    if (empty) editor.commands.setContent(`${body}${sep >= 0 ? current.slice(sep) : ''}`);
    else editor.chain().focus().insertContent(body).run();
    if (/\{[A-Za-zÄÖÜäöü]+\}/.test(htmlToPlain(body)))
      toast({ text: t('Bitte die markierten Platzhalter ergänzen.'), kind: 'info' });
  }
  async function saveAsTemplate() {
    const name = await prompt({
      title: t('Als Vorlage speichern'),
      message: t('Platzhalter wie {Vorname} oder {Datum} werden beim Einfügen ersetzt.'),
      label: t('Name der Vorlage'),
      value: subject.slice(0, 80),
      confirmLabel: t('Speichern'),
      validate: v => (v.trim() && v.length <= 80 ? null : t('1–80 Zeichen'))
    });
    if (!name) return;
    const current = format === 'html' ? html : plainToHtml(text);
    const sep = current.indexOf(SIGNATURE_SEPARATOR);
    try {
      await postJson(
        '/api/templates/save',
        { name: name.trim(), subject, html: sep >= 0 ? current.slice(0, sep) : current },
        'mail-v1'
      );
      toast({ text: t('Vorlage „{name}“ gespeichert.', { name: name.trim() }), kind: 'success' });
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) return;
    const next = [...files, ...Array.from(incoming)];
    if (next.length > MAX_ATTACHMENTS || next.reduce((s, f) => s + f.size, 0) > MAX_TOTAL_BYTES) {
      setError(t('Maximal acht Anhänge mit insgesamt 8 MiB.'));
      return;
    }
    setFiles(next);
    setError('');
  }
  async function insertImage(file: File | undefined) {
    if (!file || !editor) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      toast({ text: t('Nur PNG, JPEG, GIF oder WebP.'), kind: 'error' });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast({ text: t('Bilder im Text bis 1 MB. Größere Dateien bitte als Anhang.'), kind: 'error' });
      return;
    }
    editor
      .chain()
      .focus()
      .setImage({ src: await fileToDataUrl(file), alt: file.name })
      .run();
  }
  function switchFormat(next: 'html' | 'text') {
    if (next === format) return;
    if (next === 'text') setText(htmlToPlain(html));
    else editor?.commands.setContent(plainToHtml(text));
    setFormat(next);
  }

  const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer.types).includes('Files');
  const saveLabel =
    saveStatus === 'saving'
      ? t('Speichert …')
      : saveStatus === 'saved' && !changed
        ? t('Entwurf gespeichert')
        : saveStatus === 'uncertain'
          ? t('Speicherstatus unklar')
          : saveStatus === 'error'
            ? t('Entwurf nicht gespeichert')
            : '';
  const titles = {
    new: t('Neue Nachricht'),
    reply: t('Antworten'),
    replyAll: t('Allen antworten'),
    forward: t('Weiterleiten')
  };

  return (
    <div
      className="compose-overlay"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) void close();
      }}
    >
      <section
        className={`compose-panel ${dragging ? 'is-dragging-files' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('E-Mail verfassen')}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            if (scheduleOpen) setScheduleOpen(false);
            else void close();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit(null);
          }
        }}
        onDragEnter={e => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={e => {
          if (hasFiles(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDragLeave={e => {
          if (!dragging) return;
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={e => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="compose-drop-overlay" aria-hidden="true">
            <Paperclip size={26} />
            <strong>{t('Dateien hier ablegen')}</strong>
          </div>
        )}
        <header className="compose-head">
          <h2>{initial.draftUid ? t('Entwurf bearbeiten') : titles[initial.mode]}</h2>
          <span className="draft-state" role="status">
            {saveLabel}
          </span>
          <button
            className="icon-button"
            aria-label={t('Schließen')}
            title={t('Schließen (Esc)')}
            onClick={() => void close()}
          >
            <X size={20} />
          </button>
        </header>
        <div className="compose-scroll">
          <div className="compose-form">
            <label className="compose-row">
              {t('Von')}
              <select value={from} onChange={e => setFrom(e.target.value)} aria-label={t('Absender')}>
                {identities.map(i => (
                  <option key={i.email} value={i.email}>
                    {i.name ? `${i.name} <${i.email}>` : i.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="recipient-row">
              <RecipientInput
                accountId={accountId}
                label={t('An')}
                value={to}
                onChange={setTo}
                placeholder="name@firma.at"
                autoFocus={!initial.to}
              />
              {!showCopies && (
                <button type="button" className="text-button subtle" onClick={() => setShowCopies(true)}>
                  {t('CC/BCC')}
                </button>
              )}
            </div>
            {showCopies && (
              <>
                <RecipientInput accountId={accountId} label="CC" value={cc} onChange={setCc} />
                <RecipientInput
                  accountId={accountId}
                  label="BCC"
                  value={bcc}
                  onChange={setBcc}
                  placeholder={t('für andere unsichtbar')}
                />
              </>
            )}
            <label className="compose-row">
              {t('Betreff')}
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={250}
                autoFocus={Boolean(initial.to) && !initial.subject}
              />
            </label>

            <div className="compose-options">
              <TemplateMenu onInsert={tpl => void insertTemplate(tpl)} onSaveCurrent={() => void saveAsTemplate()} />
              <div className="segmented small" role="radiogroup" aria-label={t('Format')}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={format === 'html'}
                  className={format === 'html' ? 'active' : ''}
                  onClick={() => switchFormat('html')}
                >
                  {t('Formatiert')}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={format === 'text'}
                  className={format === 'text' ? 'active' : ''}
                  onClick={() => switchFormat('text')}
                >
                  {t('Nur Text')}
                </button>
              </div>
              <div className="security-options">
                <ShieldCheck size={14} />
                <select
                  aria-label={t('Ende-zu-Ende-Schutz')}
                  value={security.method || ''}
                  onChange={e =>
                    setSecurity(
                      e.target.value === 'password'
                        ? { method: 'password', sign: false, encrypt: true, password: generatePassword(), hint: '' }
                        : {
                            method: (e.target.value || null) as Security['method'],
                            sign: Boolean(e.target.value),
                            encrypt: false
                          }
                    )
                  }
                >
                  <option value="">{t('Ohne Verschlüsselung')}</option>
                  <option value="password">{t('Mit Passwort schützen')}</option>
                  <option value="pgp">OpenPGP</option>
                  <option value="smime">S/MIME</option>
                </select>
                {security.method && security.method !== 'password' && (
                  <>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={security.sign}
                        onChange={e => setSecurity({ ...security, sign: e.target.checked })}
                      />{' '}
                      <PenLine size={13} /> {t('Signieren')}
                    </label>
                    <label className="toggle small">
                      <input
                        type="checkbox"
                        checked={security.encrypt}
                        onChange={e => setSecurity({ ...security, encrypt: e.target.checked })}
                      />{' '}
                      <Lock size={13} /> {t('Verschlüsseln')}
                    </label>
                  </>
                )}
              </div>
            </div>
            {security.method === 'password' && (
              <PasswordPanel
                password={security.password || ''}
                hint={security.hint || ''}
                onChange={patch => setSecurity({ ...security, ...patch })}
              />
            )}
            {missing && (missing.own || missing.recipients.length > 0) && (
              <p className="compose-warning" role="alert">
                {missing.own && (
                  <>
                    {security.method === 'pgp'
                      ? t('Für {from} gibt es keinen (entsperrten) OpenPGP-Schlüssel.', { from })
                      : t('Für {from} ist kein S/MIME-Zertifikat eingerichtet.', { from })}{' '}
                  </>
                )}
                {missing.recipients.length > 0 &&
                  t('Kein Schlüssel für: {list}', { list: missing.recipients.join(', ') })}{' '}
                {t('Einstellungen → Sicherheit')}
              </p>
            )}

            {format === 'html' && editor ? (
              <>
                <Toolbar editor={editor} onImage={() => imageInput.current?.click()} />
                <input
                  ref={imageInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  hidden
                  onChange={e => {
                    void insertImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <EditorContent editor={editor} className="compose-editor-wrap" />
              </>
            ) : (
              <textarea
                className="compose-body"
                aria-label={t('Nachricht')}
                value={text}
                onChange={e => setText(e.target.value)}
                rows={14}
              />
            )}
            {initial.notice && <p className="compose-hint">{initial.notice}</p>}

            <div className="compose-files">
              <div className="compose-files-head">
                <Paperclip size={15} /> {t('Anhänge')}{' '}
                <span>
                  {files.length}/{MAX_ATTACHMENTS} · {prettySize(totalBytes)} / 8 MiB
                </span>
              </div>
              {files.map((file, i) => (
                <div className="compose-file" key={`${file.name}-${i}`}>
                  <FileText size={15} />
                  <span>
                    {file.name} <small>{prettySize(file.size)}</small>
                  </span>
                  <button
                    aria-label={t('{name} entfernen', { name: file.name })}
                    onClick={() => setFiles(old => old.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <label className="compose-file-picker">
                + {t('Dateien auswählen')}
                <input
                  type="file"
                  multiple
                  onChange={e => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {error && (
              <p className="compose-error" role="alert">
                {error}
              </p>
            )}
            {!sendEnabled && (
              <p className="compose-hint">
                {t('Versand ist für dieses Konto derzeit nicht verfügbar. Bitte die Kontoeinstellungen prüfen.')}
              </p>
            )}
          </div>
        </div>
        <footer className="compose-controls">
          <label className="followup-select" title={t('Erinnert dich, wenn bis dahin keine Antwort eingegangen ist.')}>
            <BellRing size={14} />
            <select
              value={followUpDays}
              onChange={e => setFollowUpDays(Number(e.target.value))}
              aria-label={t('Nachfassen')}
            >
              <option value={0}>{t('Nicht nachfassen')}</option>
              {FOLLOW_UP_DAYS.map(d => (
                <option key={d} value={d}>
                  {d === 1
                    ? t('Nachfassen nach 1 Tag')
                    : d === 7
                      ? t('Nachfassen nach 1 Woche')
                      : t('Nachfassen nach {n} Tagen', { n: d })}
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <button className="btn" onClick={() => void close()}>
            {changed && draftsEnabled ? t('Als Entwurf schließen') : t('Schließen')}
          </button>
          <div className="split-button">
            <button
              className="btn primary"
              disabled={!sendEnabled}
              onClick={() => void submit(null)}
              title={t('Strg/⌘ + Enter')}
            >
              <Send size={15} /> {t('Senden')}
            </button>
            <button
              className="btn primary split-toggle"
              disabled={!sendEnabled}
              aria-label={t('Später senden')}
              aria-expanded={scheduleOpen}
              onClick={() => setScheduleOpen(!scheduleOpen)}
            >
              <ChevronDown size={15} />
            </button>
            {scheduleOpen && (
              <WhenMenu
                className="schedule-menu"
                title={t('Später senden')}
                note={t('Levuvo Mail muss zum Zeitpunkt laufen (auch im Hintergrund).')}
                onClose={() => setScheduleOpen(false)}
                onPick={date => {
                  setScheduleOpen(false);
                  void submit(date.toISOString());
                }}
              />
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

/** Password protection: password (generated, editable, copyable), optional hint, guidance. */
function PasswordPanel({
  password,
  hint,
  onChange
}: {
  password: string;
  hint: string;
  onChange: (patch: { password?: string; hint?: string }) => void;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const [visible, setVisible] = useState(true);
  const strength = password.length >= 16 ? 'strong' : password.length >= 10 ? 'ok' : 'weak';
  return (
    <div className="password-panel">
      <div className="password-row">
        <label>
          {t('Passwort für den Empfänger')}
          <span className="password-input">
            <input
              type={visible ? 'text' : 'password'}
              value={password}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={e => onChange({ password: e.target.value })}
              aria-describedby="password-help"
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisible(!visible)}
              aria-label={visible ? t('Passwort verbergen') : t('Passwort anzeigen')}
              title={visible ? t('Passwort verbergen') : t('Passwort anzeigen')}
            >
              {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => onChange({ password: generatePassword() })}
              aria-label={t('Neues Passwort erzeugen')}
              title={t('Neues Passwort erzeugen')}
            >
              <RefreshCw size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Passwort kopieren')}
              title={t('Passwort kopieren')}
              onClick={() =>
                void navigator.clipboard
                  .writeText(password)
                  .then(() => toast({ text: t('Passwort kopiert.'), kind: 'success' }))
                  .catch(() => toast({ text: t('Kopieren nicht möglich.'), kind: 'error' }))
              }
            >
              <Copy size={15} />
            </button>
          </span>
          <span className={`password-strength ${strength}`}>
            {strength === 'weak'
              ? t('Zu kurz (mindestens 10 Zeichen)')
              : strength === 'ok'
                ? t('Ausreichend')
                : t('Stark')}
          </span>
        </label>
        <label>
          {t('Hinweis zum Passwort (optional)')}
          <input
            type="text"
            value={hint}
            maxLength={120}
            placeholder={t('z. B. „wie besprochen am Telefon“')}
            onChange={e => onChange({ hint: e.target.value })}
          />
        </label>
      </div>
      <p className="password-help" id="password-help">
        <KeyRound size={13} />{' '}
        {t(
          'Text und Anhänge werden mit dem Passwort verschlüsselt (AES-256). Der Empfänger öffnet die angehängte Datei in jedem Browser. Teile das Passwort auf einem anderen Weg mit – z. B. per SMS oder Telefon. Der Betreff bleibt lesbar.'
        )}
      </p>
    </div>
  );
}
