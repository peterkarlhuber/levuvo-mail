// Video call building blocks: a new Jitsi link (built locally, see video-call.mjs), the button that
// joins a call and the settings for the server. Joining opens the link in the browser; the desktop
// app asks first, like for every outside link.
import { useEffect, useState } from 'react';
import { Copy, LoaderCircle, Video } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { findVideoLink, type VideoLink, type VideoSettings } from './video-call';

let cached: Promise<VideoSettings> | null = null;
/** Replaces the cached settings after a change in the settings. */
export const setVideoSettings = (next: VideoSettings) => (cached = Promise.resolve(next));
/** Video settings, loaded once per session (and again after a change). */
export function loadVideoSettings(force = false) {
  if (!cached || force)
    cached = getJson<VideoSettings>('/api/video').then(s => {
      if (typeof s?.server !== 'string' || typeof s.defaultServer !== 'string')
        throw new Error('Verbindung fehlgeschlagen.');
      return { ...s, custom: typeof s.custom === 'string' ? s.custom : '' };
    });
  cached.catch(() => (cached = null));
  return cached;
}

export const newVideoLink = () => postJson<VideoLink>('/api/video/link', {}, 'mail-v1');

/** Configured server, for recognising call links in text. */
export function useVideoServers() {
  const [servers, setServers] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    loadVideoSettings()
      .then(s => live && setServers([s.server, s.defaultServer]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return servers;
}

/** Button that creates a new call link and hands it over. */
export function AddVideoCallButton({
  onLink,
  label,
  className = 'btn small'
}: {
  onLink: (link: VideoLink) => void;
  label?: string;
  className?: string;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          onLink(await newVideoLink());
        } catch (err) {
          toast({ kind: 'error', text: (err as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Video size={14} aria-hidden="true" />}{' '}
      {label || t('Videocall hinzufügen')}
    </button>
  );
}

/** "Join" and "Copy link" for the first call link in `text`; nothing when there is none. */
export function JoinVideoCall({ text }: { text: string }) {
  const { t } = useT();
  const { toast } = useUi();
  const servers = useVideoServers();
  const url = findVideoLink(text, servers);
  if (!url) return null;
  return (
    <span className="video-call-actions">
      <a className="btn small primary" href={url} target="_blank" rel="noopener noreferrer">
        <Video size={14} aria-hidden="true" /> {t('Videocall beitreten')}
      </a>
      <button
        type="button"
        className="btn small"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(url)
            .then(() => toast({ kind: 'info', text: t('Link kopiert.') }))
            .catch(() => {})
        }
      >
        <Copy size={14} aria-hidden="true" /> {t('Link kopieren')}
      </button>
    </span>
  );
}
