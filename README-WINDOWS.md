# Levuvo Mail 2.2.0 – Windows ARM64 und x64

Das Schlüsselbund-Modul ist nativ: **immer auf der Zielarchitektur bauen**.

```powershell
node -p "process.platform + ' ' + process.arch"   # erwartet: win32 arm64 bzw. win32 x64
npm.cmd ci
npm.cmd run release:check
npm.cmd run desktop:win:check:vault
npm.cmd run desktop:win:arm64                      # bzw. desktop:win:x64
```

Ergebnis: `release\Levuvo-Mail-Setup-2.2.0-arm64.exe` bzw. `-x64.exe`.
Projekt lokal (z. B. `C:\Users\<Name>\Levuvo\levuvo-mail`) bauen, nicht von einem Netzlaufwerk.

Signierter Build mit Auto-Update: `npm.cmd run release:signed:win:x64` – Voraussetzungen in `RELEASE-KIT.md`.

Hinweise:
- Passwörter liegen in der Windows-Anmeldeinformationsverwaltung (Dienst `at.levuvo.mail`).
- Der Installer installiert pro Benutzer, ohne Administratorrechte, und zeigt die Lizenz an.
- Unsignierte Test-Installer lösen eine SmartScreen-Warnung aus. Keine Schutzfunktionen global abschalten.
