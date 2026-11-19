# Accessibility – EAA, EN 301 549, WCAG 2.2

**Not legal advice** – see [README.md](README.md).

## Applicability

| Law / standard | Assessment |
| --- | --- |
| European Accessibility Act, Directive (EU) 2019/882; Austria: Barrierefreiheitsgesetz (BaFG) | Applies to the products and services listed in Art. 2 (computers and operating systems, terminals, e-books, e-commerce, banking, electronic communications **services**, …). A stand-alone email client sold as software is **most likely not covered**: it is neither a listed product nor an electronic communications service (Levuvo provides no service). To be confirmed legally, especially if Levuvo ever offers a hosted service. Microenterprises providing services are exempt (Art. 4(5)) |
| Public procurement, Directive 2014/24/EU Art. 42 and Web Accessibility Directive (EU) 2016/2102 | Public bodies must buy accessible ICT; **EN 301 549** (V3.2.1, references WCAG 2.1 AA; next version WCAG 2.2) is the reference. Relevant for selling to public administration |
| Austrian Web-Zugänglichkeits-Gesetz (WZG) | for public bodies' websites and apps; not for Levuvo directly |

## Target

Levuvo Mail aims at **WCAG 2.2 level AA** and the software clauses of **EN 301 549 chapter 11**,
voluntarily and as a selling point for public customers.

## State

| Area | Evidence |
| --- | --- |
| Automated WCAG 2.2 AA check (axe-core) of all modules, keyboard paths, phone layout | `npm run test:a11y` in CI (`test/a11y/a11y.test.mjs`) |
| Design tokens with contrast-checked colours (light/dark) | [docs/design-system.md](../design-system.md), `npm run check:tokens` |
| Keyboard operation, visible focus, screen reader announcements | release checklist "Accessibility and mobile" (VoiceOver, Narrator) |
| Reflow (320 px), text resizing | a11y test phone layout, release checklist |
| Documentation accessible | manual as tagged PDF (thread "Benutzerhandbuch als PDF erstellen") |

## Gaps

- No manual audit by an accessibility expert yet → before selling to public bodies, commission an
  EN 301 549 audit and publish an accessibility conformance report (VPAT/ACR, EN 301 549 edition).
- AI outputs: keep announcing results via live regions (already done) and keep markers text-based.

## Accessibility statement (template for the website)

> Levuvo Mail aims to conform to WCAG 2.2 level AA and EN 301 549 chapter 11. Known limitations:
> [list]. Feedback and requests for accessible formats: [contact]. Last reviewed: [date].
