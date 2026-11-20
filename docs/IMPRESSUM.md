# Imprint (Impressum)

> The same details appear in the app under Settings → About (`apps/web/src/Settings.tsx`,
> “Legal notice” section) and in the privacy notice (`PRIVACY.md`). Levuvo is still a start-up
> project without a registered company; update this page once it is founded. Legal review recommended.
>
> The filename stays `IMPRESSUM.md` because the German app text refers to `docs/IMPRESSUM.md`.
> Austrian law requires this disclosure; the German legal terms are kept in parentheses.

**Disclosure pursuant to § 5 E-Commerce Act (E-Commerce-Gesetz, ECG), § 14 Commercial Code (Unternehmensgesetzbuch, UGB) and § 25 Media Act (Mediengesetz)**

| Item | Value |
|---|---|
| Media owner and manufacturer (Medieninhaber und Hersteller) | Levuvo (Gründungsprojekt / start-up project), Peter Karlhuber |
| Address | Laussastraße 24, 4460 Losenstein, Austria |
| Contact | Email: office@levuvo.at |
| Business purpose (Unternehmensgegenstand) | [e.g. development and distribution of software] |
| Company register number / court (Firmenbuchnummer / -gericht) | not registered (start-up project) |
| VAT ID (UID-Nummer) | none yet |
| Membership / trade authority | [Austrian Economic Chamber (Wirtschaftskammer) …] / [district authority or municipal office …] |
| Professional law | Trade Regulation Act (Gewerbeordnung), www.ris.bka.gv.at |
| Basic orientation (§ 25 MedienG) | Information about Levuvo Mail and Levuvo products |

**Consumer dispute resolution:** Levuvo Mail is used internally only and not sold to consumers, so no information on consumer dispute resolution is needed. The EU ODR platform was discontinued on 20 July 2025 (Regulation (EU) 2024/3228); do not link to it. If Levuvo is ever offered to consumers, add the information required by the Austrian Alternative Dispute Resolution Act (AStG) and have it reviewed legally.

**Liability for links:** Links in emails come from the respective senders; Levuvo Mail asks for confirmation before opening them.

## Replace in the app

1. `apps/web/src/Settings.tsx` → component `About` → fill the `legal-block` with the real details.
2. `PRIVACY.md` → section “Controller” and the placeholders for the update server and crash reports.
3. Run `npm run release:check` and build the release.
