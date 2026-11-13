# Sicherheit

## Meldung von Schwachstellen

Bitte **nicht** öffentlich als Issue melden. Nutzen Sie _Security → Report a vulnerability_ (GitHub Private Vulnerability Reporting) in diesem Repository oder schreiben Sie an die auf <https://levuvo.at> genannte Kontaktadresse. Wir bestätigen den Eingang zeitnah.

## Unterstützte Versionen

Es wird jeweils die neueste veröffentlichte Version unterstützt.

## Maßnahmen in diesem Repository

- CI: `npm audit` (Runtime blockierend ab _high_; Gesamtabhängigkeiten ab _high_ blockierend, Rest im Job-Summary), Secret-Scan, CodeQL, Workflow-Richtlinien-Check.
- Workflows: `contents: read` als Standard, Schreibrechte nur im Publish-Job, SHA-gepinnte Actions, kein `pull_request_target`, Secrets nur im geschützten Environment `release-signing`.
- Dependabot für npm und GitHub Actions.
- Zugangsdaten liegen ausschließlich im Betriebssystem-Schlüsselbund, nie im Repository oder Installer.

## Bekannte offene Punkte

Siehe `docs/CI-CD.md` → „Offene Sicherheitsbefunde“.
