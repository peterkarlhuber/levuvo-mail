// Texts for the AI error codes (`ai_<kind>`). The kinds are a contract with the sidecar and the
// server, listed in apps/ai/levuvo_ai/error_kinds.json; a test checks that each one has its own
// text here, so the user learns what went wrong and what to do instead of a generic failure.

const texts = (t: (s: string) => string): Record<string, string> => ({
  // Server side
  ai_disabled: t('KI ist ausgeschaltet. In den Einstellungen unter „KI & Agenten“ einschalten.'),
  ai_feature_disabled: t('Diese KI-Funktion ist ausgeschaltet.'),
  ai_runtime_missing: t('Die KI-Komponente fehlt in dieser Installation.'),
  ai_consent_missing: t('Für Cloud-KI fehlt die Einwilligung.'),
  ai_cloud_blocked: t('Für dieses Konto ist Cloud-KI gesperrt.'),
  ai_not_configured: t('Der KI-Anbieter ließ sich nicht umstellen. Bitte die KI-Einstellungen prüfen.'),
  ai_crashed: t('Die KI-Komponente ist mehrmals abgestürzt und pausiert für einige Minuten. Danach erneut versuchen.'),
  ai_stopped: t('Die KI-Komponente wurde neu gestartet. Bitte erneut versuchen.'),
  ai_vault: t('Schlüsselbund nicht verfügbar. Der API-Schlüssel wird nicht gespeichert.'),
  // Model and provider
  ai_unreachable: t('Das KI-Modell ist nicht erreichbar. Läuft Ollama?'),
  // Levuvo's own Ollama and its model list
  ai_checksum: t('Prüfsumme stimmt nicht. Das Modell wurde entfernt. Bitte erneut herunterladen.'),
  ai_download_failed: t('Der Download ist fehlgeschlagen. Bitte erneut versuchen.'),
  ai_not_in_catalog: t('Dieses Modell steht nicht in der Modellliste von Levuvo Mail.'),
  ai_busy: t('Gerade läuft ein Download. Bitte warten, bis er fertig ist.'),
  ai_unavailable: t('Der KI-Anbieter ist gerade überlastet oder gestört. Später erneut versuchen.'),
  ai_model_missing: t('Das gewählte Modell ist nicht installiert. In den Einstellungen herunterladen.'),
  ai_not_embedding_model: t(
    'Das gewählte Suchmodell kann keine Suchvektoren berechnen. Bitte ein Embedding-Modell wählen.'
  ),
  ai_auth: t('API-Schlüssel fehlt oder ist ungültig.'),
  ai_rate_limit: t('Der KI-Anbieter begrenzt gerade die Anfragen. Bitte etwas warten und erneut versuchen.'),
  ai_timeout: t('Das Modell hat zu lange gebraucht.'),
  ai_disk_full: t('Zu wenig Speicherplatz für den Modell-Download. Bitte Platz schaffen und erneut versuchen.'),
  ai_network: t('Der Modell-Download hat keine Internetverbindung. Bitte Verbindung oder Proxy prüfen.'),
  ai_ollama: t('Ollama hat die Anfrage abgelehnt. Bitte Ollama neu starten oder aktualisieren.'),
  // The request or the answer
  ai_unsupported: t(
    'Das gewählte Modell kann diese Funktion nicht (z. B. keine Werkzeuge für Routinen). Bitte ein anderes Modell wählen.'
  ),
  ai_too_many_steps: t('Die Aufgabe brauchte zu viele Schritte und wurde abgebrochen. Bitte kleiner formulieren.'),
  ai_agent_tools: t('Die Werkzeuge für Agenten sind nicht erreichbar. Ist der MCP-Server eingeschaltet?'),
  ai_invalid_output: t(
    'Das Modell hat keine verwertbare Antwort geliefert. Erneut versuchen oder ein größeres Modell wählen.'
  ),
  ai_too_long: t('Die Antwort des Modells wurde abgeschnitten. Bitte mit weniger Text erneut versuchen.'),
  ai_input_too_long: t('Der Text ist für das Modell zu lang. Bitte weniger Nachrichten oder kürzeren Text wählen.'),
  ai_refused: t('Das Modell hat die Anfrage abgelehnt.'),
  ai_invalid_input: t('Die Anfrage an die KI war ungültig.'),
  ai_invalid: t('Die Anfrage an die KI war ungültig.')
});

/** Readable reason for an AI error code (ai_*). */
export function aiErrorText(code: string | undefined, t: (s: string) => string) {
  return (code && texts(t)[code]) || t('KI-Funktion fehlgeschlagen.');
}

/** Codes with their own text (for the contract test). */
export const AI_ERROR_CODES = Object.keys(texts(s => s));
