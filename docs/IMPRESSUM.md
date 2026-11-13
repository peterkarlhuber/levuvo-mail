# Impressum – Vorlage

> Diese Vorlage füllt Levuvo vor der Veröffentlichung aus. Die gleichen Platzhalter stehen in der App
> unter Einstellungen → Über (`apps/web/src/Settings.tsx`, Abschnitt „Impressum“) und im
> Datenschutzhinweis (`DATENSCHUTZ.md`). Rechtliche Prüfung empfohlen.

**Offenlegung gemäß § 5 E-Commerce-Gesetz (ECG), § 14 Unternehmensgesetzbuch (UGB) und § 25 Mediengesetz**

| Angabe | Wert |
|---|---|
| Medieninhaber und Hersteller | [Firmenname] [Rechtsform, z. B. e.U. / GmbH] |
| Anschrift | [Straße Hausnummer], [PLZ Ort], Österreich |
| Kontakt | E-Mail: [kontakt@levuvo.at] · Telefon: [+43 …] |
| Unternehmensgegenstand | [z. B. Entwicklung und Vertrieb von Software] |
| Firmenbuchnummer / -gericht | [FN …] / [Landesgericht …] (falls eingetragen) |
| UID-Nummer | [ATU…] (falls vorhanden) |
| Mitgliedschaft / Gewerbebehörde | [Wirtschaftskammer …] / [Bezirkshauptmannschaft bzw. Magistrat …] |
| Berufsrecht | Gewerbeordnung, www.ris.bka.gv.at |
| Grundlegende Richtung (§ 25 MedienG) | Information über Levuvo Mail und Levuvo-Produkte |

**Verbraucherstreitbeilegung:** [Hinweis auf die OS-Plattform der EU bzw. ob Bereitschaft zur Teilnahme an Streitbeilegungsverfahren besteht – rechtlich prüfen lassen.]

**Haftung für Links:** Links in E-Mails stammen von den jeweiligen Absendern; Levuvo Mail fragt vor dem Öffnen nach.

## In der App ersetzen

1. `apps/web/src/Settings.tsx` → Komponente `About` → Block `legal-block` mit den echten Angaben füllen.
2. `DATENSCHUTZ.md` → Abschnitt „Verantwortlicher“ und die Platzhalter für Update-Server und Absturzberichte.
3. `npm run release:check` und Release bauen.
