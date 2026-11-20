// Levuvo Mail Assistant in the composer: reply suggestion, bullet points to email, rewriting, and a
// check before sending. The assistant only ever changes the draft in the editor; the user sends.
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { ApiError } from './api';
import { aiEnabled, aiErrorText, runAi, type AiFeature } from './ai';
export { ownPart } from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button } from './ui';
import { focusFirstItem, menuKeyDown } from './ui/menu-keys';

type Draft = { subject: string; body: string; styleContact?: string };
type Issue = { kind: 'attachment' | 'tone' | 'recipient' | 'sensitive' | 'legal'; message: string };

const REWRITES: { mode: string; label: string }[] = [
  { mode: 'shorter', label: 'Kürzer' },
  { mode: 'polite', label: 'Höflicher' },
  { mode: 'formal', label: 'Förmlicher' },
  { mode: 'casual', label: 'Lockerer' },
  { mode: 'proofread', label: 'Rechtschreibung korrigieren' },
  { mode: 'english', label: 'Auf Englisch' },
  { mode: 'german', label: 'Auf Deutsch' }
];

type Props = {
  accountId: string;
  source?: { folder: string; uid: number };
  /** The user's own text, without signature and quote. */
  getDraft: () => string;
  /** Replaces the user's own text (signature and quote stay). */
  setDraft: (text: string) => void;
  subject: string;
  setSubject: (s: string) => void;
  /** The first recipient typed in "To": a new mail then follows the style learned for that person. */
  recipient?: string;
  /** Model that wrote the current text, or null after undo (machine-readable marking on send). */
  onAssisted?: (model: string | null) => void;
};

export function ComposerAssist({
  accountId,
  source,
  getDraft,
  setDraft,
  subject,
  setSubject,
  recipient,
  onAssisted
}: Props) {
  const { t, lang } = useT();
  const { toast } = useUi();
  const [features, setFeatures] = useState<Partial<Record<AiFeature, boolean>> | null>(null);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const undo = useRef<string | null>(null);
  // The last change by the assistant stays marked with an undo until the next run, not only in a
  // 5-second toast (EU AI Act Art. 50 marking, WCAG 2.2.1).
  const [changed, setChanged] = useState<{ model: string; contact: string } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    const list: AiFeature[] = ['reply', 'compose', 'rewrite'];
    void Promise.all(list.map(async f => [f, await aiEnabled(f)] as const)).then(
      r => alive && setFeatures(Object.fromEntries(r))
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    focusFirstItem(list.current);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!features || !Object.values(features).some(Boolean)) return null;

  async function run(kind: 'reply' | 'compose' | 'rewrite', input: Record<string, unknown>, label: string) {
    setOpen(false);
    setBusy(label);
    try {
      const refs = source && kind !== 'rewrite' ? [source] : undefined;
      const withTo = kind === 'compose' && recipient ? { ...input, to: recipient } : input;
      const r = await runAi<Draft>(kind, { account: accountId, refs, input: withTo, lang });
      const before = getDraft();
      undo.current = before;
      setDraft(r.result.body);
      if (r.result.subject && !subject.trim()) setSubject(r.result.subject);
      setChanged({ model: r.model, contact: r.result.styleContact || '' });
      onAssisted?.(r.model);
      toast({
        text: t('Vom Assistenten geschrieben ({model}). Bitte vor dem Senden prüfen.', { model: r.model }),
        kind: 'info',
        action: { label: t('Rückgängig'), run: revert }
      });
    } catch (err) {
      toast({ text: aiErrorText(err instanceof ApiError ? err.code : undefined, t), kind: 'error' });
    } finally {
      setBusy('');
    }
  }

  function revert() {
    if (undo.current !== null) setDraft(undo.current);
    undo.current = null;
    setChanged(null);
    onAssisted?.(null);
  }
  const closeMenu = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const draft = () => getDraft().trim();
  return (
    <div className="menu-anchor compose-ai" ref={menu}>
      <Button
        ref={trigger}
        size="sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={Boolean(busy)}
        aria-busy={Boolean(busy) || undefined}
        onClick={() => setOpen(o => !o)}
        title={t('Levuvo Mail Assistant')}
        icon={busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
      >
        {busy || t('Assistent')}
      </Button>
      {changed && !busy && (
        <span className="ai-label compose-ai-changed">
          <Sparkles size={11} aria-hidden="true" /> {t('Vom Assistenten geändert ({model})', { model: changed.model })}
          {changed.contact && <> · {t('Im Stil deiner Mails an {email}', { email: changed.contact })}</>}{' '}
          <button type="button" className="text-button" onClick={revert}>
            {t('Rückgängig')}
          </button>
        </span>
      )}
      {open && (
        <div
          ref={list}
          className="menu template-menu left"
          role="menu"
          aria-label={t('Levuvo Mail Assistant')}
          onKeyDown={e => menuKeyDown(e, closeMenu)}
        >
          {features.reply && source && (
            <button
              role="menuitem"
              onClick={() => void run('reply', { instruction: draft() }, t('Antwort wird geschrieben …'))}
            >
              {draft() ? t('Antwort aus meinen Stichworten') : t('Antwort vorschlagen')}
            </button>
          )}
          {features.compose && (
            <button
              role="menuitem"
              disabled={!draft()}
              onClick={() => void run('compose', { bullets: draft() }, t('Mail wird geschrieben …'))}
            >
              {t('Stichpunkte zu fertiger Mail')}
            </button>
          )}
          {features.rewrite &&
            REWRITES.map(r => (
              <button
                key={r.mode}
                role="menuitem"
                disabled={!draft()}
                onClick={() => void run('rewrite', { mode: r.mode, text: draft() }, t('Wird umformuliert …'))}
              >
                {t(r.label)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * Check before sending (forgotten attachment, tone, recipient, sensitive data). Returns the issues, or an
 * empty list when the check is off, fails or takes longer than `timeoutMs`: it must never block sending.
 */
export async function presendIssues(
  input: { accountId: string; subject: string; text: string; recipients: string[]; hasAttachments: boolean },
  lang: string,
  timeoutMs = 20_000
): Promise<Issue[]> {
  if (!(await aiEnabled('attachmentCheck')) || !input.text.trim()) return [];
  const check = runAi<{ issues: Issue[] }>('presend', {
    account: input.accountId,
    input: {
      subject: input.subject,
      text: input.text,
      recipients: input.recipients,
      hasAttachments: input.hasAttachments
    },
    lang
  })
    .then(r => r.result.issues || [])
    .catch(() => []);
  const timeout = new Promise<Issue[]>(resolve => setTimeout(() => resolve([]), timeoutMs));
  return Promise.race([check, timeout]);
}
