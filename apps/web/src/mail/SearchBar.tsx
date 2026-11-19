// Search field above the message list with the "everywhere" scope toggle.
// Split out of MailInstance (ARC-LEV-005).
import { Globe2, Search, X } from 'lucide-react';
import { useT } from '../i18n';
import type { SearchScope } from './search-state';

type Props = {
  query: string;
  scope: SearchScope;
  disabled: boolean;
  /** Name of the open folder for the placeholder. */
  folderName: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onToggleScope: () => void;
};

export default function SearchBar({ query, scope, disabled, folderName, onChange, onClear, onToggleScope }: Props) {
  const { t } = useT();
  return (
    <div className="search-row">
      <label className="searchbox">
        <Search size={16} />
        <input
          type="search"
          aria-label={t('Suchen')}
          disabled={disabled}
          placeholder={
            scope === 'everywhere'
              ? t('Alle Ordner und Konten durchsuchen (auch offline)')
              : t('In „{folder}“ suchen', { folder: folderName })
          }
          value={query}
          maxLength={120}
          onChange={e => onChange(e.target.value)}
        />
        {query && (
          <button aria-label={t('Suche löschen')} onClick={onClear}>
            <X size={14} />
          </button>
        )}
      </label>
      <button
        className={`scope-toggle ${scope === 'everywhere' ? 'active' : ''}`}
        aria-pressed={scope === 'everywhere'}
        title={t('Überall suchen (lokaler, verschlüsselter Suchindex)')}
        onClick={onToggleScope}
      >
        <Globe2 size={15} />
        <span>{t('Überall')}</span>
      </button>
    </div>
  );
}
