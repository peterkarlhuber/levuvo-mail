# Levuvo Mail 2.2.1

Email, calendar and contacts for **macOS (Apple Silicon)** and **Windows (ARM64, x64)**.
*Less effort. More impact.*

- **Email:** IMAP (993/TLS) and SMTP (587/STARTTLS, 465/TLS), up to five accounts, sender addresses (aliases), HTML editor with signatures and logo, **conversations**, **undo for all actions**, **snooze**, **follow-up**, **templates**, **newsletter unsubscribe**, undo send, send later, folder management with drag & drop, flagging, spam, print/PDF, .eml, attachment preview
- **Calendar** (on the device without an account, CalDAV and **Microsoft 365 and Google directly**) with recurrence, reminders, invitations and drag & drop · **Contacts** (CardDAV, Microsoft 365, Google) with vCard import/export
- **Command palette (Ctrl/⌘ + K)**, quick actions in the list, provider tiles during setup
- **Password-protected messages** for any recipient (AES-256, opened in the browser) · **Security:** passwords, tokens and private keys only in the keychain · phishing warnings (SPF/DKIM/DMARC, links, attachments) · OpenPGP and S/MIME · protected HTML view
- **Server filters and vacation reply** (Sieve) · **Sign-in with Microsoft 365 and Google** (OAuth 2.0)
- **Encrypted local search index** – search across all folders and accounts, even offline
- German and English, light and dark theme

What's new: [CHANGELOG.md](./CHANGELOG.md) · Manual (DE): [docs/HANDBUCH.md](./docs/HANDBUCH.md) · Manual (EN): [docs/MANUAL.md](./docs/MANUAL.md) · Privacy: [PRIVACY.md](./PRIVACY.md) · Imprint template: [docs/IMPRESSUM.md](./docs/IMPRESSUM.md)

## Development

Requirement: Node.js 22.12 or newer.

```bash
npm ci                 # exactly the versions from package-lock.json
npm run dev            # API (browser mode, port 3001) + Vite (http://127.0.0.1:5173)
npm run desktop:dev    # Electron app locally
```

In browser mode, test accounts can be set via environment variables (`IMAP_USER`, `IMAP_PASSWORD`, `IMAP_HOST`, `ENABLE_SEND=true` …). The desktop app deliberately ignores them (exception: `LEVUVO_OAUTH_*` for test builds, see `docs/OAUTH-SETUP.md`).

### Quality checks

```bash
npm run release:check  # audit, syntax, ESLint, Prettier, tests, TypeScript, build, license notices
npm run check:i18n     # every UI and server message has an English translation
```

#### Integration tests against real servers (optional, write test data)

Requires two test mailboxes on a mail server with local delivery and ManageSieve, a CalDAV/CardDAV server with two users and optionally an OAuth test provider. **Use only with your own test accounts.**

```bash
export LEVUVO_IT_ALLOW_WRITES=1 LEVUVO_IT_IMAP_HOST=mail.test.example LEVUVO_IT_SMTP_PORT=465
export LEVUVO_IT_USER=peter@test.example LEVUVO_IT_PASSWORD=… LEVUVO_IT_USER2=anna@test.example LEVUVO_IT_PASSWORD2=…
export LEVUVO_IT_DAV_URL=https://dav.test.example/ LEVUVO_IT_DAV_USER=peter LEVUVO_IT_DAV_PASSWORD=… LEVUVO_IT_DAV_USER2=anna LEVUVO_IT_DAV_PASSWORD2=…
export LEVUVO_IT_OAUTH_URL=http://127.0.0.1:9900     # optional
npm run test:integration
```

#### End-to-end UI test (browser)

Same environment variables, plus Playwright with Chromium:

```bash
npm run build
npx playwright install chromium
npm run test:e2e        # or LEVUVO_PLAYWRIGHT=$(npm root -g)/playwright for a global installation
```

The test operates the app like a human (composing with formatting, undo, replying, folders and drag & drop, phishing warning, attachment preview, send later, calendar with invitation and reply, contacts, OpenPGP, filters/vacation reply, conversation, undo, snooze, follow-up, templates, command palette, newsletter unsubscribe, offline search, English and light theme) and stores screenshots under `test/e2e/screenshots/`.

### Structure

| Path | Contents |
|---|---|
| `apps/server/src/app.mjs` | local API (Fastify), `127.0.0.1` only, session cookie, action header |
| `apps/server/src/routes-*.mjs` | email, accounts/OAuth, calendar/contacts, encryption/diagnostics |
| `apps/server/src/inbox-watcher.mjs` | IMAP IDLE connection per account |
| `apps/server/src/dav.mjs`, `calendar-model.mjs`, `vcard.mjs` | CalDAV/CardDAV, iCalendar, iTIP, vCard |
| `apps/server/src/cloud.mjs` | calendar & contacts via Microsoft Graph and Google Calendar/People API |
| `apps/server/src/local-calendar.mjs` | “On this device” calendar (encrypted, .ics export/import) |
| `apps/server/src/protected-message.mjs` | password-protected messages (encryption, browser view) |
| `apps/server/src/thread.mjs`, `followups.mjs`, `templates.mjs`, `unsubscribe.mjs` | conversations, snooze/follow-up, templates, newsletter unsubscribe |
| `apps/server/src/pgp.mjs`, `smime.mjs`, `mime-crypto.mjs` | OpenPGP, S/MIME, PGP/MIME |
| `apps/server/src/sieve.mjs` | ManageSieve client, rules, vacation reply |
| `apps/server/src/local-index.mjs` | encrypted search index |
| `apps/server/src/security-analysis.mjs` | phishing detection |
| `apps/desktop/main.mjs` | Electron main process, tray, notifications, reminders, updates |
| `apps/web/src/` | React UI (`App`, `MailInstance`, `Reader`, `Composer`, `Calendar`, `Contacts`, `Settings`, `CommandPalette` …) |
| `apps/web/src/i18n-en.ts` | English texts (key = German source text) |

## Building installers

See [RELEASE-KIT.md](./RELEASE-KIT.md) (test installers and signed releases) and [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md) (acceptance). Windows details: [README-WINDOWS.md](./README-WINDOWS.md). Enabling OAuth sign-in: [docs/OAUTH-SETUP.md](./docs/OAUTH-SETUP.md).

## Upgrading from 2.0

Just install – everything is carried over. Microsoft and Google accounts show “Allow access” once in calendar and contacts (additional permission). Own builds: add the new permissions in Azure or Google, see [docs/OAUTH-SETUP.md](./docs/OAUTH-SETUP.md).

## Upgrading from 1.x

Just install. Accounts and passwords (keychain service `at.levuvo.mail`) are carried over. Connect calendar and contacts under Settings → Calendar & contacts.
