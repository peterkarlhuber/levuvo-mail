# Conformity assessment and CE marking – notes

CRA Art. 7, 28–32, Annex VIII. **Not legal advice; the decision is Peter's after legal review.**

## 1. Procedure

1. **Confirm the category.** Assessment: default category (not in Annex III/IV), see [../CRA.md](../CRA.md)
   § 1. If a lawyer or the implementing act places it in Annex III class I (for example because of the
   embedded Chromium), internal control is still possible **only** when harmonised standards or
   common specifications are applied in full (Art. 32(2)); otherwise EU-type examination (module B+C)
   or full quality assurance (module H) with a notified body.
2. **Internal control (module A, Annex VIII):**
   - technical documentation complete ([TECHNICAL-DOCUMENTATION.md](TECHNICAL-DOCUMENTATION.md));
   - design, development and vulnerability handling meet Annex I ([../CRA.md](../CRA.md) §§ 2–3, all
     rows "Done", gaps justified);
   - production process (CI, release workflow) ensures every build conforms.
3. **Declaration of conformity** signed ([EU-DECLARATION-OF-CONFORMITY.md](EU-DECLARATION-OF-CONFORMITY.md)).
4. **CE marking** (Art. 30): for software, on the declaration, in the About dialog, on the download
   page and in the accompanying documents. Visible, legible, at least 5 mm high where physically
   shown (Art. 30(1)-(2), Regulation (EC) No 765/2008 Art. 30).
5. **Repeat** for every version that is a substantial modification (Art. 3(30)); security updates
   alone are not a substantial modification (recital 39).

## 2. Readiness checklist

- [ ] Code signing certificates in place; signed and notarised release built
- [ ] Support period decided and set in `package.json` → `levuvo.supportUntil`
- [ ] Security contact address and security.txt live
- [ ] Manufacturer details in the imprint and in the app
- [ ] Legal review of category, of this file and of the declaration
- [ ] Reporting access to the ENISA single reporting platform set up
- [ ] CE marking added to About (only after the steps above): `apps/web/src/Settings.tsx` → About

## 3. Notified body

Not needed for the default category. If needed: list of notified bodies under the CRA in the
Commission's NANDO database [check availability; notification of bodies from 11 June 2026].
