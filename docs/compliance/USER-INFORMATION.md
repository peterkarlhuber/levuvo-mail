# Information for users – security, privacy and AI

Information and instructions according to CRA Annex II, AI Act Art. 50 and GDPR Art. 13. Shipped
in the release kit; the essentials are shown in the app (Settings → About → "Security and support",
Settings → Privacy, Settings → AI & agents). Source for the manual chapters on security, privacy and
AI. Placeholders in [brackets] are filled in before Levuvo Mail is made available on the market.

## 1. Manufacturer and contact (Annex II no. 1–2)

- Manufacturer: [Company name, legal form], [address], Austria – see the imprint in Settings → About.
- Contact: [kontakt@levuvo.at]
- Reporting a vulnerability: GitHub "Report a vulnerability" on the Levuvo Mail repository or
  [security@levuvo.at]; policy in [SECURITY.md](../../SECURITY.md).

## 2. Product (Annex II no. 3–4)

Levuvo Mail [version], desktop application for macOS 12+ (Apple silicon) and Windows 10/11 (x64,
ARM64). Intended purpose: email, calendar, contacts, tasks and shared spaces for professional use,
with an optional AI assistant.

## 3. Security support (Annex II no. 7)

- Security updates free of charge until **[end of support, e.g. 30 November 2031]** for the 2.x line
  (shown in Settings → About).
- Updates are installed **automatically** by default (signed builds). You can switch this off under
  Settings → Privacy → "Install updates automatically"; Levuvo Mail then only tells you when an
  update is available. Please install security updates promptly.
- The EU declaration of conformity: [internet address] (Annex II no. 6).
- The software bill of materials (SBOM) is attached to each release as `levuvo-mail-<version>.cdx.json`.

## 4. Using Levuvo Mail securely (Annex II no. 8)

- Install only from the official release page; check the SHA-256 sums in `SHA256SUMS.txt`.
- Keep the operating system up to date, use full-disk encryption (FileVault / BitLocker) and a
  screen lock: Levuvo Mail encrypts its own files, but the keychain is only as safe as your user account.
- Use app passwords or "Sign in with Microsoft/Google" (OAuth) instead of your main password where
  your provider offers it.
- Leave external images blocked for unknown senders; confirm links only when you trust them.
- Phishing warnings are hints: check payment requests and changed bank details by phone.
- AI and agents: keep cloud AI off for accounts with confidential content ("No cloud AI"), give
  agents the lowest level that suffices, read every approval like an outgoing mail.
- Backups: protect the backup file and its password like the computer itself.
- Before sending, Levuvo Mail may show hints (open recipient lists, unencrypted sensitive or health
  data, and with the AI check discriminatory wording). They are hints: you decide, and nothing is
  recorded or reported.

### Risks of reasonably foreseeable use (Annex II no. 5)

Mail can contain malicious links and attachments; AI output can be wrong or manipulated by hidden
instructions in a mail (prompt injection); a connected agent at the level "organize" acts without
asking; sending data to a cloud model may breach professional secrecy.

## 5. Removing data and uninstalling (Annex I Part I (2)(m))

- Settings → Privacy → "Delete all data on this device" removes all data Levuvo Mail stored on this
  computer (settings, accounts, local calendar, contacts, tasks, spaces, search index, AI data and
  log, models of Levuvo's own Ollama) and its entries in the keychain, then restarts in a fresh state.
  Mail on your providers' servers is not touched.
- Settings → Privacy → "Export my data" saves a readable copy of the data that exists only on this
  device (JSON). To move to a new computer, use the encrypted backup (Settings → Backup).
- Uninstall: macOS – move the app to the trash; Windows – Settings → Apps. Delete data first if you
  hand the computer to someone else.

## 6. AI transparency (AI Act Art. 50)

- The Levuvo Mail Assistant is an AI system. It is off until you switch it on.
- Every AI result is marked ("AI-generated", "Written by the assistant", "AI-created") with the model.
- Mails whose text the assistant wrote or rewrote carry a machine-readable header
  `X-Levuvo-AI-Assisted` when sent; drafts from external agents carry `X-Levuvo-AI-Generated`. You
  can switch the header off (Settings → AI & agents → "Mark AI-written mails"), which may be appropriate
  only if you have substantially rewritten the text yourself.
- The local model runs on your computer; a cloud model is used only after your consent per provider.
- What AI can and cannot do: [docs/ai/AI-LITERACY.md](../ai/AI-LITERACY.md).

## 7. Privacy

See the privacy notice [PRIVACY.md](../../PRIVACY.md) (Settings → Privacy). Levuvo Mail has no
server of its own and no telemetry.
