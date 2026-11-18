// Reader menu entry: puts the open mail into a shared space.
import { useEffect, useState } from 'react';
import { LoaderCircle, Users } from 'lucide-react';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { spaces, type SpaceList } from './spaces-api';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function AddToSpaceMenu({
  accountId,
  folder,
  uid,
  onDone
}: {
  accountId: string;
  folder: string;
  uid: number;
  onDone: () => void;
}) {
  const { t } = useT();
  const ui = useUi();
  const [list, setList] = useState<SpaceList | null>(null);
  const [withAttachments, setWithAttachments] = useState(true);
  useEffect(() => {
    void spaces
      .list()
      .then(setList, () => setList({ identity: { id: '', safetyCode: '' }, spaces: [], invitations: [] }));
  }, []);
  const writable = (list?.spaces || []).filter(s => s.status === 'active' && s.role !== 'reader');
  return (
    <div className="menu space-pick" role="menu">
      <strong className="menu-title">{t('In Raum legen')}</strong>
      {!list && <LoaderCircle className="spin" size={14} />}
      {list && !writable.length && <span className="muted small">{t('Kein Raum, in dem du schreiben darfst.')}</span>}
      {writable.map(s => (
        <button
          key={s.id}
          role="menuitem"
          onClick={async () => {
            onDone();
            try {
              await spaces.post(`/${s.id}/mails/add`, { account: accountId, folder, uid, withAttachments });
              ui.toast({ kind: 'success', text: t('In „{name}“ gelegt.', { name: s.name }) });
            } catch (err) {
              ui.toast({ kind: 'error', text: errorText(err) });
            }
          }}
        >
          <Users size={14} /> {s.name}
        </button>
      ))}
      <label className="check small">
        <input type="checkbox" checked={withAttachments} onChange={e => setWithAttachments(e.target.checked)} />{' '}
        {t('Anhänge als Dateien mitnehmen')}
      </label>
    </div>
  );
}
