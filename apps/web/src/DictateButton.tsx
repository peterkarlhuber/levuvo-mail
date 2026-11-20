// Microphone button in the composer: dictate, then the text is inserted at the cursor. Whisper runs
// on this device; the inserted text stays marked as dictated until the next change by the assistant.
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, IconButton } from './ui';
import {
  MAX_SECONDS,
  decodeAudio,
  dictationModel,
  loadModel,
  logDictation,
  startRecording,
  transcribe,
  type SpeechModel
} from './speech';

type Recording = Awaited<ReturnType<typeof startRecording>>;

export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const { t, lang } = useT();
  const { toast } = useUi();
  const [model, setModel] = useState<SpeechModel | null>(null);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'working'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const rec = useRef<Recording | null>(null);

  useEffect(() => {
    let alive = true;
    void dictationModel().then(m => alive && setModel(m));
    return () => {
      alive = false;
      rec.current?.cancel();
    };
  }, []);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  if (!model) return null;

  async function start() {
    if (!model) return;
    try {
      // The model loads while the user speaks.
      void loadModel(model, setLoadPct).catch(() => {});
      rec.current = await startRecording(() => void stop());
      setSeconds(0);
      setPhase('recording');
    } catch {
      toast({ text: t('Kein Zugriff auf das Mikrofon. Bitte in den Systemeinstellungen erlauben.'), kind: 'error' });
    }
  }

  async function stop() {
    const r = rec.current;
    rec.current = null;
    if (!r || !model) return;
    setPhase('working');
    let length = 0;
    try {
      const { blob, seconds: s } = await r.stop();
      length = s;
      const audio = await decodeAudio(blob);
      await loadModel(model, setLoadPct);
      const text = await transcribe(audio, lang === 'en' ? 'english' : 'german');
      if (text) {
        onText(text);
        toast({
          text: t('Diktiert mit {model}, auf diesem Gerät. Bitte vor dem Senden prüfen.', { model: model.name }),
          kind: 'info'
        });
      } else toast({ text: t('Es wurde keine Sprache erkannt.'), kind: 'info' });
      void logDictation(length, true);
    } catch {
      void logDictation(length, false);
      toast({ text: t('Diktieren fehlgeschlagen. Bitte erneut versuchen.'), kind: 'error' });
    } finally {
      setPhase('idle');
      setLoadPct(null);
    }
  }

  function cancel() {
    rec.current?.cancel();
    rec.current = null;
    setPhase('idle');
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (phase === 'recording')
    return (
      <span className="dictate recording" role="status" aria-live="polite">
        <span className="dictate-dot" aria-hidden="true" />
        <span>
          {t('Aufnahme')} {clock} / {Math.floor(MAX_SECONDS / 60)}:00
        </span>
        <Button size="sm" variant="primary" icon={<Square size={12} />} onClick={() => void stop()}>
          {t('Fertig')}
        </Button>
        <IconButton size="sm" label={t('Abbrechen')} icon={<X size={14} />} onClick={cancel} />
      </span>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={phase === 'working'}
      aria-busy={phase === 'working' || undefined}
      title={t('Diktieren (lokal mit {model})', { model: model.name })}
      icon={phase === 'working' ? <LoaderCircle className="spin" size={14} /> : <Mic size={14} />}
      onClick={() => void start()}
    >
      {phase === 'working'
        ? loadPct !== null && loadPct < 100
          ? t('Modell lädt … {pct} %', { pct: Math.round(loadPct) })
          : t('Wird umgewandelt …')
        : t('Diktieren')}
    </Button>
  );
}
