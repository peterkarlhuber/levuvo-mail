# Release-Prozess

Releases entstehen **ausschließlich in GitHub Actions** aus einem geprüften Commit auf `master` – keine manuellen ZIP-Dateien.

## Ablauf

1. Feature-Branch → Pull Request → CI (`CI`-Workflow) muss grün sein → Merge in `master`.
2. Release-PR: `version` in `package.json` und `package-lock.json` erhöhen (`npm version X.Y.Z --no-git-tag-version`), `CHANGELOG.md` um `## X.Y.Z` ergänzen, mergen.
3. Release starten – eine der beiden Varianten:
   - **Tag:** `git tag vX.Y.Z <commit-auf-master> && git push origin vX.Y.Z` (Tag muss exakt zu `package.json` passen).
   - **Manuell:** Actions → _Release_ → _Run workflow_ (Branch `master`; Option `signed` nur mit Zertifikaten).
4. Der Workflow prüft Version/Tag, führt `release:check` aus, baut parallel macOS ARM64, Windows ARM64 und Windows x64, verifiziert die Binär-Architektur (PE/Mach-O), startet die entpackte App kurz, bildet Prüfsummen und legt einen **Draft-Release** an.
5. Draft prüfen, `RELEASE-CHECKLIST.md` auf Zielgeräten abarbeiten, erst dann manuell veröffentlichen.

Bestehende Tags und Releases werden nie überschrieben: existiert `vX.Y.Z` bereits, bricht der Workflow ab.

## Artefakte

| Datei | Plattform |
|---|---|
| `Levuvo-Mail-<v>-arm64.dmg` | macOS Apple Silicon |
| `Levuvo-Mail-Setup-<v>-arm64.exe` | Windows ARM64 |
| `Levuvo-Mail-Setup-<v>-x64.exe` | Windows x64 |
| `SHA256SUMS.txt`, `release-manifest.json`, `RELEASE_NOTES.md` | alle |

Die Dateinamen folgen electron-builder (`-arm64`/`-x64`); sie sind von den Update-Metadaten (`latest*.yml`) abhängig und werden deshalb nicht umbenannt.

## Signierung

Ohne Zertifikate entstehen **unsignierte interne Testversionen** (Draft als _Pre-release_ markiert, Auto-Update aus). Signierte Releases brauchen im GitHub-Environment `release-signing` (Reviewer-Freigabe empfohlen) folgende Secrets:

| Secret | Zweck |
|---|---|
| `LEVUVO_UPDATE_URL` | https-Update-Feed (z. B. `https://levuvo.at/downloads/mail/`) |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Zertifikat (.p12 für macOS Developer ID, .pfx für Windows; base64 bzw. Pfad) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarisierung |
| `LEVUVO_WIN_PUBLISHER` | exakter Zertifikats-CN |

Signierte Builds prüfen die Signatur (`Get-AuthenticodeSignature`, `codesign`, `spctl`, `stapler`) und scheitern bei Fehlern. Da macOS- und Windows-Zertifikate getrennte Dateien sind, ist ggf. je Plattform ein eigenes Secret nötig (`WIN_CSC_LINK`) – siehe `scripts/release-signed.mjs`.

## Updates

`electron-updater` wird nur aktiv, wenn der Build einen Update-Feed enthält (`app-update.yml`) – also nur bei signierten Builds. Unsignierte Builds aktualisieren sich nie selbst. Zum Ausrollen alle Dateien des signierten Releases (inkl. `latest*.yml`, `.blockmap`, `.zip`) auf `LEVUVO_UPDATE_URL` hochladen; GitHub-Drafts dienen nicht als Update-Feed.

## Build vs. Abnahme

Ein erfolgreicher Workflow belegt: Tests, Build, Architektur, Prüfsummen, App-Start. **Er ersetzt keine Abnahme** (Schlüsselbund im Alltag, Benachrichtigungen, Tray, Autostart, echte Postfächer) – siehe `RELEASE-CHECKLIST.md`.
