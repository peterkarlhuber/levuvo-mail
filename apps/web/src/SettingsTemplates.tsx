import { useCallback, useEffect, useState } from 'react';
import { FileStack, Pencil, Plus, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { RichTextField } from './editor';
import { useT } from './i18n';
import { Section } from './Settings';
import { PLACEHOLDERS, type Template } from './templates';

export function TemplateSettings() {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [items, setItems] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => getJson<{ templates: Template[] }>('/api/templates').then(d => setItems(d.templates)),
    []
  );
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError('');
    try {
      await postJson('/api/templates/save', edit, 'mail-v1');
      setEdit(null);
      await load();
      toast({ text: t('Vorlage gespeichert.'), kind: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Template) {
    if (
      !(await confirm({
        title: t('Vorlage „{name}“ löschen?', { name: item.name }),
        confirmLabel: t('Löschen'),
        danger: true
      }))
    )
      return;
    await postJson('/api/templates/delete', { id: item.id }, 'mail-v1');
    void load();
  }

  return (
    <Section
      title={t('Textbausteine und Vorlagen')}
      description={t(
        'Wiederkehrende Antworten, Angebote oder Begrüßungen. Im Editor über „Vorlagen“ einfügen. Platzhalter werden beim Einfügen ersetzt: {list}',
        { list: PLACEHOLDERS.join(' ') }
      )}
    >
      {items.length === 0 && !edit && (
        <p className="muted">
          <FileStack size={14} /> {t('Noch keine Vorlagen.')}
        </p>
      )}
      {items.map(item => (
        <div className="key-row" key={item.id}>
          <FileStack size={16} />
          <span>
            <strong>{item.name}</strong>
            <small>{item.subject || t('ohne Betreff')}</small>
          </span>
          <button
            className="icon-button"
            aria-label={t('Bearbeiten')}
            title={t('Bearbeiten')}
            onClick={() => setEdit(item)}
          >
            <Pencil size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={t('Löschen')}
            title={t('Löschen')}
            onClick={() => void remove(item)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {edit ? (
        <div className="managed-form">
          <div className="managed-field-grid">
            <label>
              {t('Name')}
              <input
                value={edit.name || ''}
                maxLength={80}
                autoFocus
                onChange={e => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              {t('Betreff (optional)')}
              <input
                value={edit.subject || ''}
                maxLength={250}
                onChange={e => setEdit({ ...edit, subject: e.target.value })}
              />
            </label>
          </div>
          <RichTextField
            key={edit.id || 'new'}
            label={t('Text der Vorlage')}
            value={edit.html || ''}
            onChange={html => setEdit(old => (old ? { ...old, html } : old))}
          />
          {error && <p className="modal-error">{error}</p>}
          <div className="managed-form-buttons">
            <button className="btn" onClick={() => setEdit(null)}>
              {t('Abbrechen')}
            </button>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>
              {t('Speichern')}
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-actions">
          <button
            className="btn small"
            onClick={() => setEdit({ name: '', subject: '', html: `<p>${t('Hallo {Vorname},')}</p><p></p>` })}
          >
            <Plus size={14} /> {t('Neue Vorlage')}
          </button>
        </div>
      )}
    </Section>
  );
}
