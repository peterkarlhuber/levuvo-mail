// Settings → Privacy → "Stored data on this device": where Levuvo Mail keeps its data, with the
// real paths of this computer, their sizes and (desktop app) a button to show a folder.
import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { formatBytes } from './format';
import { useT } from './i18n';
import { Button } from './ui';

type FolderId = 'data' | 'models' | 'index' | 'spaces' | 'restore';
type Storage = {
  dataDir: string;
  platform: string;
  canOpen: boolean;
  folders: { id: FolderId; path: string; exists: boolean; bytes: number | null }[];
};

const LABELS: Record<FolderId, { title: string; text: string }> = {
  data: {
    title: 'App-Datenordner',
    text: 'Einstellungen und Konten ohne Passwörter (z. B. app-settings.json, ai.json, accounts.json), öffentliche Schlüssel und Zertifikate, CalDAV/CardDAV-Konten, Vorlagen sowie lokale Kontakte, Kalender und Aufgaben (verschlüsselt).'
  },
  models: {
    title: 'KI-Modelle',
    text: 'Die Modelle des eigenen Ollama von Levuvo Mail. Getrennt von einem anderen installierten Ollama.'
  },
  index: {
    title: 'Suchindex',
    text: 'Verschlüsselter Suchindex pro Konto (Betreff, Absender, die ersten 3.000 Zeichen Text) samt den Einträgen für die Suche nach Bedeutung. Lässt sich jederzeit neu aufbauen.'
  },
  spaces: { title: 'Räume', text: 'Inhalte der gemeinsamen Räume, Ende-zu-Ende-verschlüsselt.' },
  restore: {
    title: 'Sicherheitskopien',
    text: 'Der vorherige Stand nach einer Wiederherstellung. Sicherungen selbst speicherst du an einem Ort deiner Wahl.'
  }
};

export function StorageLocations() {
  const { t, locale } = useT();
  const { toast } = useUi();
  const [storage, setStorage] = useState<Storage | null>(null);
  useEffect(() => {
    void getJson<Storage>('/api/storage')
      .then(setStorage)
      .catch(() => setStorage(null));
  }, []);
  async function open(id: FolderId) {
    try {
      await postJson('/api/storage/open', { id }, 'mail-v1');
    } catch {
      toast({ text: t('Der Ordner konnte nicht geöffnet werden.'), kind: 'error' });
    }
  }
  const openLabel = storage?.platform === 'darwin' ? t('Im Finder zeigen') : t('Im Explorer zeigen');
  return (
    <ul className="plain-list storage-list">
      <li>
        {t(
          'Schlüsselbund des Betriebssystems: Passwörter, OAuth-Token, private Schlüssel (PGP/S/MIME), Indexschlüssel.'
        )}
      </li>
      <li>
        {t(
          'Verschlüsselt (AES-256-GCM, Schlüssel im Schlüsselbund): Aufgaben, Kontakte und Kalender auf diesem Gerät sowie die Notizen im Kontaktverlauf.'
        )}
      </li>
      {(Array.isArray(storage?.folders) ? storage.folders : [])
        .filter(f => f.id !== 'restore' || f.exists)
        .map(f => (
          <li key={f.id} className="storage-item">
            <div>
              <strong>{t(LABELS[f.id]?.title ?? f.id)}</strong>
              {f.bytes !== null && <small> · {formatBytes(f.bytes, locale)}</small>}
              <code className="storage-path">{f.path}</code>
              <small className="storage-hint">{t(LABELS[f.id].text)}</small>
            </div>
            {storage?.canOpen && (
              <Button
                size="sm"
                variant="ghost"
                icon={<FolderOpen size={14} />}
                aria-label={`${openLabel}: ${t(LABELS[f.id].title)}`}
                onClick={() => void open(f.id)}
              >
                {openLabel}
              </Button>
            )}
          </li>
        ))}
      <li>
        {t(
          'E-Mails bleiben auf dem Mailserver. Zuletzt geladene Listen und Nachrichten für die Offline-Ansicht liegen nur im Arbeitsspeicher.'
        )}
      </li>
    </ul>
  );
}
