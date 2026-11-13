# Imprint (Impressum) – template

> Levuvo fills in this template before publication. The same placeholders appear in the app
> under Settings → About (`apps/web/src/Settings.tsx`, “Legal notice” section) and in the
> privacy notice (`PRIVACY.md`). Legal review recommended.
>
> The filename stays `IMPRESSUM.md` because the German app text refers to `docs/IMPRESSUM.md`.
> Austrian law requires this disclosure; the German legal terms are kept in parentheses.

**Disclosure pursuant to § 5 E-Commerce Act (E-Commerce-Gesetz, ECG), § 14 Commercial Code (Unternehmensgesetzbuch, UGB) and § 25 Media Act (Mediengesetz)**

| Item | Value |
|---|---|
| Media owner and manufacturer (Medieninhaber und Hersteller) | [Company name] [legal form, e.g. e.U. / GmbH] |
| Address | [Street number], [postcode city], Austria |
| Contact | Email: [kontakt@levuvo.at] · Phone: [+43 …] |
| Business purpose (Unternehmensgegenstand) | [e.g. development and distribution of software] |
| Company register number / court (Firmenbuchnummer / -gericht) | [FN …] / [Regional Court …] (if registered) |
| VAT ID (UID-Nummer) | [ATU…] (if available) |
| Membership / trade authority | [Austrian Economic Chamber (Wirtschaftskammer) …] / [district authority or municipal office …] |
| Professional law | Trade Regulation Act (Gewerbeordnung), www.ris.bka.gv.at |
| Basic orientation (§ 25 MedienG) | Information about Levuvo Mail and Levuvo products |

**Consumer dispute resolution:** [Reference to the EU ODR platform and whether there is willingness to participate in dispute resolution proceedings – have this reviewed legally.]

**Liability for links:** Links in emails come from the respective senders; Levuvo Mail asks for confirmation before opening them.

## Replace in the app

1. `apps/web/src/Settings.tsx` → component `About` → fill the `legal-block` with the real details.
2. `PRIVACY.md` → section “Controller” and the placeholders for the update server and crash reports.
3. Run `npm run release:check` and build the release.
