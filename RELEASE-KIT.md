# Levuvo Mail 2.2.0 – Release-Kit

Das ZIP enthält den vollständigen Quellcode, die gesperrte Abhängigkeitsliste (`package-lock.json`)
und die Build-Konfiguration für drei Plattformen. **Fertige DMG/EXE-Dateien sind nicht enthalten**:
Sie müssen auf dem jeweiligen Betriebssystem gebaut werden (natives Schlüsselbund-Modul).

| Plattform | Datei | Build-Rechner |
|---|---|---|
| macOS Apple Silicon | `Levuvo-Mail-2.2.0-arm64.dmg` (+ `.zip` für Updates) | Mac mit Apple Silicon |
| Windows 11 ARM64 | `Levuvo-Mail-Setup-2.2.0-arm64.exe` | Windows ARM64 (z. B. UTM) |
| Windows x64 | `Levuvo-Mail-Setup-2.2.0-x64.exe` | Windows Intel/AMD |

## A) Test-Installer (unsigniert, ohne Auto-Update)

```bash
npm ci
npm run release:check
npm run desktop:mac                      # bzw. desktop:win:arm64 / desktop:win:x64
npm run release:manifest -- --arch arm64 # bzw. x64
```

Unsignierte Installer lösen Gatekeeper- bzw. SmartScreen-Warnungen aus und aktualisieren sich nicht selbst.
Nur für interne Tests verwenden.

## B) Signierter Release mit automatischen Updates

### Einmalig besorgen

| Wofür | Was | Hinweis |
|---|---|---|
| macOS | Apple Developer Program (99 USD/Jahr), Zertifikat **Developer ID Application** als `.p12` | Notarisierung über App-spezifisches Passwort |
| Windows | Code-Signing-Zertifikat (OV/EV) als `.pfx` **oder** Azure Trusted Signing | ohne Signatur warnt SmartScreen |
| Updates | HTTPS-Ordner, z. B. `https://levuvo.at/downloads/mail/` | statischer Webspace genügt |

### Umgebungsvariablen (niemals ins Repository!)

```bash
LEVUVO_UPDATE_URL=https://…/mail/
# macOS
CSC_LINK=/pfad/developer-id.p12   CSC_KEY_PASSWORD=…
APPLE_ID=…   APPLE_APP_SPECIFIC_PASSWORD=…   APPLE_TEAM_ID=…
# Windows
CSC_LINK=C:\pfad\codesign.pfx   CSC_KEY_PASSWORD=…
LEVUVO_WIN_PUBLISHER="Exakter Name aus dem Zertifikat (CN)"
```

### Bauen

```bash
npm ci
npm run release:check
npm run release:signed:mac          # auf dem Mac
npm run release:signed:win:x64      # auf Windows x64
npm run release:signed:win:arm64    # auf Windows ARM64
npm run release:manifest -- --signed
```

Danach **alle** Dateien aus `release/` (Installer, `.zip`, `.blockmap`, `latest.yml`, `latest-mac.yml`)
in den Ordner `LEVUVO_UPDATE_URL` hochladen. Installierte signierte Versionen finden das Update
innerhalb von sechs Stunden (oder sofort über „Nach Updates suchen …“) und installieren es nach
Rückfrage beim Neustart.

Signierte macOS-Builds verwenden `build/entitlements.mac.release.plist` (Library Validation aktiv),
Test-Builds `build/entitlements.mac.plist`.

## C) Über GitHub Actions

- `ci.yml` läuft bei jedem Push: `npm ci` + `npm run release:check`.
- `build-desktop.yml` startet man manuell. Ohne Häkchen „signed“ entstehen Test-Installer; mit Häkchen
  signierte Releases. Dafür die Werte aus Abschnitt B als **Repository-Secrets** anlegen
  (`CSC_LINK` als Base64 des Zertifikats). Alle Actions sind auf feste Commits gepinnt.
- Artefakte bleiben private Actions-Artefakte (14 Tage).

## D) Vor dem ersten öffentlichen Release ausfüllen

| Was | Wo | Hinweis |
|---|---|---|
| Impressum und Verantwortlicher | `apps/web/src/Settings.tsx` (Über), `DATENSCHUTZ.md` | Vorlage: `docs/IMPRESSUM.md` |
| Microsoft-/Google-Anmeldung | `package.json` → `levuvo.oauth` | Registrierung: `docs/OAUTH-SETUP.md` (Google: Verifizierung/CASA einplanen) |
| Absturzberichte (optional) | `package.json` → `levuvo.crashReportUrl` (https) | z. B. eigener Crashpad-/Sentry-Minidump-Endpunkt; bleibt aus, bis Nutzer:innen zustimmen |
| Update-Server | `LEVUVO_UPDATE_URL` | siehe Abschnitt B |

Ohne diese Angaben funktioniert die App vollständig – die OAuth-Schaltflächen erscheinen dann nicht,
Absturzberichte sind technisch deaktiviert.

## Prüfsummen

`npm run release:manifest` schreibt `SHA256SUMS.txt` und `release-manifest.json` aus den echten Dateien,
`npm run release:verify` prüft, dass alle drei Installer vorhanden sind und die Summen stimmen.

## Was nicht ins Paket gehört

Keine `.env`, kein `accounts.json`, keine Zertifikate (`*.p12`, `*.pfx` – Ausnahme: wertlose Testzertifikate unter `apps/server/test/fixtures/`, siehe dortige README), keine Mails. `.gitignore`
und die `files`-Liste in `package.json` schließen das aus.
