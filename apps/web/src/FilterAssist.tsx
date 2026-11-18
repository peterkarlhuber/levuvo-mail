// "Filter in words": the assistant turns a description into a filter rule. The rule is only added to the
// list; the user reviews it in the editor below and saves the filters as usual.
import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { ApiError } from './api';
import { aiEnabled, aiErrorText, runAi } from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';

export type AiRule = {
  name: string;
  match: 'all' | 'any';
  conditions: { field: 'from' | 'to' | 'subject' | 'any'; op: 'contains' | 'is' | 'not_contains'; value: string }[];
  actions: { type: 'move' | 'markRead' | 'flag'; folder?: string }[];
  stop: boolean;
  unclear?: string;
};

export function FilterAssist({
  accountId,
  folders,
  onRule
}: {
  accountId: string;
  folders: string[];
  onRule: (rule: AiRule) => void;
}) {
  const { t, lang } = useT();
  const { toast } = useUi();
  const [on, setOn] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void aiEnabled('classify').then(setOn);
  }, []);
  if (!on) return null;

  async function create() {
    setBusy(true);
    try {
      const r = await runAi<AiRule>('filter_rule', { account: accountId, input: { text, folders }, lang });
      onRule(r.result);
      setText('');
      toast({
        text: r.result.unclear
          ? t('Regel vorgeschlagen. Nicht umgesetzt: {what}', { what: r.result.unclear })
          : t('Regel vorgeschlagen ({model}). Bitte prüfen und speichern.', { model: r.model }),
        kind: 'info'
      });
    } catch (err) {
      toast({ text: aiErrorText(err instanceof ApiError ? err.code : undefined, t), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="filter-assist">
      <Sparkles size={14} aria-hidden="true" />
      <input
        value={text}
        maxLength={1000}
        placeholder={t('In Worten, z. B. „Rechnungen von Lieferanten in den Ordner Buchhaltung“')}
        aria-label={t('Regel in Worten beschreiben')}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && text.trim() && !busy && void create()}
      />
      <button className="btn small" disabled={!text.trim() || busy} onClick={() => void create()}>
        {busy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} {t('Regel vorschlagen')}
      </button>
    </div>
  );
}
