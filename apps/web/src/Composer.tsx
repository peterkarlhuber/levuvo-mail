import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { weakPassword } from './password-rules';
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
  LoaderCircle,
  Send,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import { fileToBase64, fileToDataUrl, getJson, postJson, ApiError } from './api';
import { fillTemplate, nameParts, SHORTCUT_KEYS, shortcutAt, type Template, type TemplateVars } from './templates';
import TemplateMenu from './TemplateMenu';
import { DictateButton } from './DictateButton';
import { AddVideoCallButton } from './VideoCall';
import { ComposerAssist, ownPart, presendIssues } from './ComposerAssist';
import { complianceIssues } from './compliance-checks';
import { useUi } from './ConfirmDialog';
import RecipientInput from './RecipientInput';
import { useT } from './i18n';
import { Segmented, useFocusTrap } from './ui';
import WhenMenu from './WhenMenu';
import { FOLLOW_UP_DAYS } from './when';
import { usePrefs } from './prefs';
import type { Identity } from './types';
import { MB, prettySize } from './format';

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
  /** Label of a draft an AI agent wrote (X-Levuvo-AI-Generated); kept on every save until sent. */
  aiGenerated?: string;
  draftUid?: number;
  draftUidValidity?: string;
  security?: Security;
  scheduledFor?: string;
  /** The message being answered, for the assistant's reply suggestion. */
  source?: { folder: string; uid: number };
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
  /** Text written by the assistant or an agent: becomes the header X-Levuvo-AI-Assisted (AI Act Art. 50(2)). */
  aiAssisted?: string;
};

/** Header value (printable ASCII) naming who wrote the text. */
export const aiAssistedLabel = (who: string, model = '') =>
  `${who}${model ? `; model=${model}` : ''}`.replace(/[^\x20-\x7e]/g, '').slice(0, 150);

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

const MAX_TOTAL_BYTES = 8 * MB;
const MAX_ATTACHMENTS = 8;
const MAX_IMAGE_BYTES = 1 * MB;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const parseAddresses = (value: string) => (value.trim() ? value.split(/[;,\s]+/).filter(Boolean) : []);
export default function Composer({
  accountId,
  initial,
  identities,
  sendEnabled,
  draftsEnabled,
  onClose,
  onSubmit
}: Props) {
  const { t, locale, lang } = useT();
  const trap = useFocusTrap<HTMLElement>();
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
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [security, setSecurity] = useState<Security>(initial.security || { method: null, sign: false, encrypt: false });
  // Who wrote (part of) the text: the assistant (model) or an agent; cleared by the assistant's undo.
  const [aiAssisted, setAiAssisted] = useState(
    initial.aiGenerated ? aiAssistedLabel('agent', initial.aiGenerated) : ''
  );
  const [missing, setMissing] = useState<{ recipients: string[]; own: boolean } | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
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

  // Templates with a shortcut: ";mfg" + space or Tab inserts the template in place.
  const shortcutTemplates = useRef<Template[]>([]);
  const expandShortcut = useRef<(tpl: Template) => void>(() => {});
  useEffect(() => {
    getJson<{ templates: Template[] }>('/api/templates')
      .then(d => (shortcutTemplates.current = d.templates.filter(x => x.shortcut)))
      .catch(() => {});
  }, []);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial.html || plainToHtml(initial.text || ''),
    editorProps: {
      attributes: { class: 'compose-editor', 'aria-label': t('Nachricht') },
      handleDrop: (_view, event) => Boolean(event.dataTransfer?.files?.length),
      handleKeyDown: (view, event) => {
        if (!SHORTCUT_KEYS.includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return false;
        if (!shortcutTemplates.current.length) return false;
        const { from, empty } = view.state.selection;
        if (!empty) return false;
        const before = view.state.doc.textBetween(Math.max(0, from - 40), from, '\n', '\n');
        const hit = shortcutAt(before, shortcutTemplates.current);
        if (!hit) return false;
        view.dispatch(view.state.tr.delete(from - hit.length, from));
        expandShortcut.current(hit.template);
        return true;
      }
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
      ...(aiAssisted ? { aiAssisted } : {}),
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
    [
      toList,
      ccList,
      bccList,
      subject,
      from,
      format,
      html,
      text,
      initial.inReplyTo,
      initial.references,
      files,
      security,
      aiAssisted
    ]
  );

  const saveDraft = useCallback(
    async (sig: string): Promise<boolean> => {
      if (!draftsEnabled || saving.current || uncertain.current) {
        if (saving.current) pending.current = true;
        return false;
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
            attachments: base.attachments,
            ...(initial.aiGenerated ? { aiGenerated: initial.aiGenerated } : {})
          },
          'draft-v1',
          accountId
        );
        const hadPrevious = draftMeta.current.uid != null;
        draftMeta.current = { uid: saved.uid, uidValidity: saved.uidValidity };
        savedSignature.current = sig;
        setSaveStatus('saved');
        // True only when the earlier version (e.g. the scheduled one) is gone as well.
        return !hadPrevious || saved.previousRemoved !== false;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'draft_save_uncertain') uncertain.current = true;
        setSaveStatus(uncertain.current ? 'uncertain' : 'error');
        return false;
      } finally {
        saving.current = false;
        if (pending.current) {
          pending.current = false;
          setSaveTick(n => n + 1);
        }
      }
    },
    [draftsEnabled, payloadBase, subject, from, initial.inReplyTo, initial.aiGenerated, accountId]
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
    // Only a confirmed save removes the schedule; otherwise the message would still go out.
    void saveDraft(signature).then(ok =>
      toast(
        ok
          ? { text: t('Planung aufgehoben – die Nachricht ist wieder ein Entwurf.'), kind: 'info' }
          : {
              text: t(
                'Die Planung konnte nicht aufgehoben werden. Die Nachricht wird weiterhin zum geplanten Zeitpunkt gesendet.'
              ),
              kind: 'error'
            }
      )
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

  // The user's own part of the message (before signature and quote), for the assistant.
  const QUOTE_MARKS = [SIGNATURE_SEPARATOR, '<blockquote'];
  function draftBoundary(current: string) {
    const own = ownPart(current, QUOTE_MARKS);
    // Without a signature the quote attribution ("Am … schrieb …:") is the paragraph before the quote.
    if (!current.includes(SIGNATURE_SEPARATOR) && own.length < current.length) {
      const p = own.lastIndexOf('<p>');
      if (p > 0) return own.slice(0, p);
    }
    return own;
  }
  function getDraft() {
    if (format === 'text') return ownPart(text, ['\n-- \n', '\n> ']).trim();
    return htmlToPlain(draftBoundary(editor?.getHTML() || ''));
  }
  function setDraft(value: string) {
    if (format === 'text') {
      const own = ownPart(text, ['\n-- \n', '\n> ']);
      setText(`${value.trim()}\n${text.slice(own.trimEnd().length)}`);
      return;
    }
    if (!editor) return;
    const current = editor.getHTML();
    const own = draftBoundary(current);
    editor.commands.setContent(`${plainToHtml(value.trim())}${current.slice(own.length)}`);
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
      return t('Maximal acht Anhänge und insgesamt 8 MB.');
    if (missing && (missing.own || missing.recipients.length))
      return t('Für die Verschlüsselung fehlen Schlüssel – Details oben.');
    if (security.method === 'password') {
      if ((security.password || '').length < 10) return t('Das Passwort muss mindestens 10 Zeichen lang sein.');
      if (weakPassword(security.password || ''))
        return t(
          'Dieses Passwort ist zu leicht zu erraten. Bitte das vorgeschlagene Passwort verwenden oder ein anderes wählen.'
        );
      if (totalBytes > 5 * MB) return t('Geschützte Nachrichten dürfen Anhänge bis zusammen 5 MB enthalten.');
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
    setChecking(true);
    const issues = await presendIssues(
      {
        accountId,
        subject,
        text: getDraft(),
        recipients: [...toList, ...ccList, ...bccList],
        hasAttachments: files.length > 0
      },
      lang
    ).finally(() => setChecking(false));
    // Local rules (no AI, nothing logged) come first; the AI notes follow and are marked as AI.
    const local = complianceIssues({
      from,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      text: getDraft(),
      encrypted: security.method === 'password' || (!!security.method && security.encrypt)
    }).map(i => t(i.text, { ...i.vars, ...(i.items ? { what: i.items.map(w => t(w)).join(', ') } : {}) }));
    const notes = [
      ...local.map(m => `• ${m}`),
      ...(issues.length
        ? ['', t('Hinweise des Levuvo Mail Assistant (KI):'), ...issues.map(i => `• ${i.message}`)]
        : [])
    ];
    if (
      notes.length &&
      !(await confirm({
        title: t('Vor dem Senden prüfen'),
        message: `${notes.join('\n').trim()}\n\n${t('Du entscheidest. Trotzdem senden?')}`,
        confirmLabel: sendAt ? t('Trotzdem planen') : t('Trotzdem senden')
      }))
    )
      return;
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
  async function insertTemplate(tpl: Template, at?: number) {
    const vars = await templateVars();
    if (tpl.subject && !subject.trim()) setSubject(fillTemplate(tpl.subject, vars, { html: false }));
    const body = fillTemplate(tpl.html, vars);
    if (format === 'text') {
      const plain = htmlToPlain(body);
      if (at !== undefined) {
        setText(old => old.slice(0, at) + plain + old.slice(at));
        const caret = at + plain.length;
        requestAnimationFrame(() => textArea.current?.setSelectionRange(caret, caret));
      } else setText(old => `${plain}\n\n${old}`.trim());
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
  /** Dictated text at the cursor (plain text, never parsed as HTML). */
  function insertDictation(spoken: string) {
    if (format === 'text') {
      const el = textArea.current;
      const at = el ? el.selectionStart : text.length;
      const piece = (at > 0 && !/\s$/.test(text.slice(0, at)) ? ' ' : '') + spoken;
      setText(old => old.slice(0, at) + piece + old.slice(at));
      requestAnimationFrame(() => el?.setSelectionRange(at + piece.length, at + piece.length));
      return;
    }
    editor?.chain().focus().insertContent({ type: 'text', text: spoken }).run();
  }
  expandShortcut.current = tpl => void insertTemplate(tpl);
  /** Inserts an invitation to a video call at the cursor (before the signature in an empty mail). */
  function insertVideoLink(url: string) {
    const intro = t('Videocall beitreten:');
    if (format === 'text') {
      const el = textArea.current;
      const at = el ? el.selectionStart : 0;
      const line = `${intro} ${url}\n`;
      setText(old => old.slice(0, at) + line + old.slice(at));
      const caret = at + line.length;
      requestAnimationFrame(() => textArea.current?.setSelectionRange(caret, caret));
      return;
    }
    if (!editor) return;
    const safe = url.replace(/"/g, '%22').replace(/</g, '%3C');
    editor
      .chain()
      .focus()
      .insertContent(`<p>${intro.replace(/</g, '&lt;')} <a href="${safe}">${safe}</a></p>`)
      .run();
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
      setError(t('Maximal acht Anhänge mit insgesamt 8 MB.'));
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
        ref={trap}
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
              <AddVideoCallButton
                className="btn small ghost"
                label={t('Videocall')}
                onLink={link => insertVideoLink(link.url)}
              />
              <ComposerAssist
                accountId={accountId}
                source={initial.mode === 'reply' || initial.mode === 'replyAll' ? initial.source : undefined}
                getDraft={getDraft}
                setDraft={setDraft}
                subject={subject}
                setSubject={setSubject}
                recipient={toList[0]}
                onAssisted={model =>
                  setAiAssisted(
                    model
                      ? aiAssistedLabel('Levuvo Mail Assistant', model)
                      : initial.aiGenerated
                        ? aiAssistedLabel('agent', initial.aiGenerated)
                        : ''
                  )
                }
              />
              <DictateButton onText={insertDictation} />
              <Segmented
                size="sm"
                label={t('Format')}
                value={format}
                onChange={switchFormat}
                options={[
                  { value: 'html', label: t('Formatiert') },
                  { value: 'text', label: t('Nur Text') }
                ]}
              />
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
                ref={textArea}
                className="compose-body"
                aria-label={t('Nachricht')}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (!SHORTCUT_KEYS.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
                  const el = e.currentTarget;
                  if (el.selectionStart !== el.selectionEnd) return;
                  const hit = shortcutAt(el.value.slice(0, el.selectionStart), shortcutTemplates.current);
                  if (!hit) return;
                  e.preventDefault();
                  const at = el.selectionStart - hit.length;
                  setText(old => old.slice(0, at) + old.slice(at + hit.length));
                  void insertTemplate(hit.template, at);
                }}
                rows={14}
              />
            )}
            {initial.notice && <p className="compose-hint">{initial.notice}</p>}
            {initial.aiGenerated && (
              <p className="compose-hint" role="note">
                {t('Dieser Entwurf wurde von einem KI-Agenten erstellt ({label}). Bitte vor dem Senden prüfen.', {
                  label: initial.aiGenerated
                })}
              </p>
            )}

            <div className="compose-files">
              <div className="compose-files-head">
                <Paperclip size={15} /> {t('Anhänge')}{' '}
                <span>
                  {files.length}/{MAX_ATTACHMENTS} · {prettySize(totalBytes)} / {prettySize(MAX_TOTAL_BYTES)}
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
              disabled={!sendEnabled || checking}
              onClick={() => void submit(null)}
              title={t('Strg/⌘ + Enter')}
            >
              {checking ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{' '}
              {checking ? t('Wird geprüft …') : t('Senden')}
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
  const strength =
    password.length < 10 ? 'short' : weakPassword(password) ? 'weak' : password.length >= 16 ? 'strong' : 'ok';
  // The copied password is removed from the clipboard after a minute, if it is still there.
  const clearTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  function copyPassword() {
    void navigator.clipboard
      .writeText(password)
      .then(() => {
        toast({
          text: t('Passwort kopiert. Es wird nach einer Minute aus der Zwischenablage entfernt.'),
          kind: 'success'
        });
        window.clearTimeout(clearTimer.current);
        const copied = password;
        clearTimer.current = window.setTimeout(() => {
          void navigator.clipboard
            .readText()
            .then(current => (current === copied ? navigator.clipboard.writeText('') : undefined))
            .catch(() => {});
        }, 60_000);
      })
      .catch(() => toast({ text: t('Kopieren nicht möglich.'), kind: 'error' }));
  }
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
              onClick={copyPassword}
            >
              <Copy size={15} />
            </button>
          </span>
          <span className={`password-strength ${strength}`}>
            {strength === 'short'
              ? t('Zu kurz (mindestens 10 Zeichen)')
              : strength === 'weak'
                ? t('Zu leicht zu erraten')
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
          'Text und Anhänge werden mit dem Passwort verschlüsselt (AES-256). Der Empfänger öffnet die angehängte Datei in jedem Browser. Teile das Passwort auf einem anderen Weg mit – z. B. per SMS oder Telefon. Der Betreff bleibt lesbar, und automatisch gespeicherte Entwürfe liegen bis zum Senden unverschlüsselt in deinem Entwürfe-Ordner.'
        )}
      </p>
    </div>
  );
}
