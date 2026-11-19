# Settings, security and help

## The settings at a glance

Open the settings with the slider icon at the bottom left or with `Alt` + `,`.

![Settings, General section](settings-general.png)

| Section | What you set there |
|---|---|
| General | Language, light or dark design, list density, undo send, review new senders first |
| Accounts | Add and remove accounts, signatures, additional sender addresses |
| Templates | Text snippets for recurring emails |
| Filters & vacation | Rules on the mail server and vacation reply |
| Calendar & contacts | Connect other providers' calendars, colours, import and export |
| Security | Keys and certificates for encrypted email |
| Search & offline | Time of the last check, update, rebuild, index for search by meaning |
| AI & agents | Assistant, language models, cloud consent, agents |
| Notifications | Allow and test notifications |
| Privacy | Crash reports (optional), diagnostic report, where the data is stored |
| Backup | Create and restore backups |
| Help | This manual with search, quick help, keyboard shortcuts |
| About | Version, imprint, licences |

### Signature and additional sender addresses

Under **Settings → Accounts**, click an account to edit it. There you create a **Signature**, also with links and a small logo. Under **Additional sender addresses (aliases)** you add more addresses, such as office@ and invoices@, each with its own signature. Only add addresses your mail server lets you send from.

![Accounts and signatures](settings-accounts.png)

## How Levuvo Mail protects your data

- **Everything stays on your computer.** There is no Levuvo Mail server your email passes through. Your email only goes to your mail provider's servers. Levuvo Mail doesn't record how you use the app.
- **Passwords in the secure store.** Account passwords and keys are kept in the Keychain (Mac) or the Credential Manager (Windows), never in a plain file.
- **Local data encrypted.** The search index, local calendars, contacts, tasks and spaces are encrypted on disk.
- **Safe display.** Emails are shown without scripts, external images are blocked and links ask first.
- **Only reachable from your device.** The app doesn't accept connections from other computers.
- **Crash reports only if you want.** Under **Settings → Privacy** you decide whether a technical report is sent after a crash. It may contain parts of open emails or addresses. That is why it is off by default.

![Security: keys and certificates](settings-security.png)

## Where Levuvo Mail stores data

Levuvo Mail keeps everything in a folder of its own on your computer:

- **Mac:** `~/Library/Application Support/Levuvo Mail/`
- **Windows:** `%APPDATA%\Levuvo Mail\` (that is `C:\Users\<Name>\AppData\Roaming\Levuvo Mail\`)

| What | Where in the folder |
|---|---|
| Settings, accounts without passwords, templates | Files such as `app-settings.json`, `ai.json`, `templates.json` |
| Local contacts, calendar and tasks (encrypted) | `contacts-local.json`, `calendar-local.json`, `tasks-local.json` |
| Search index including search by meaning (encrypted) | `index/` |
| AI models of the own Ollama | `ollama/models/` |
| Shared spaces (encrypted) | `spaces/` |
| Previous state after a restore | `before-restore/` |

Passwords, sign-ins and private keys are not in this folder but in the Keychain (Mac) or Credential Manager (Windows). Your mail stays on the mail server. You save backups yourself wherever you choose.

Under **Settings → Privacy → Data stored on this device** you see the paths on your computer with their sizes. **Show in Finder** (Mac) or **Show in Explorer** (Windows) opens the folder. The location cannot be changed.

All sizes in Levuvo Mail are decimal, as in Finder: 1 MB is 1,000,000 bytes. Windows Explorer counts with 1,024 and therefore shows slightly smaller numbers.

## When something doesn't work

| Problem | Solution |
|---|---|
| "Check access" appears at start | Unlock the Keychain (Mac) or check your Windows sign-in, then **Check again**. Nothing was deleted. |
| The Mac says the app is "damaged" | Ask your IT team for help. A short command in Terminal fixes this. |
| Sign-in fails | Check the password. With GMX and WEB.DE, allow IMAP access in the webmail. With Gmail, use an app password or **Sign in with Google**. |
| Sending with Microsoft 365 fails | Your IT team has to switch on "Authenticated SMTP" for the mailbox. |
| Filters are "not available" | Your provider doesn't offer server filters. Create the rules in the webmail instead. |
| Calendar doesn't connect | Check the address (starts with https), user name and app password. |
| Calendars or contacts from Microsoft or Google are missing | Click **Allow access** and confirm in the browser with the same account. In companies the IT team may have to agree. |
| A scheduled or snoozed email didn't arrive | Levuvo Mail has to be running at the scheduled time; the background is enough. Otherwise it happens at the next start. |
| No notifications | Open **Settings → Notifications** and grant permission, also in your computer's system settings. |
| The assistant doesn't answer | Under **Settings → AI & agents**, check that the language model says "… is downloaded and verified". Otherwise restart Levuvo Mail. |
| **Disrupted** is shown | The mail server isn't answering properly. Check the connection under **Settings → Accounts**; waiting a moment often helps. |

## Get help

1. Open **Settings → Privacy** and click **Download** next to **Diagnostic report**.
2. Send the report with a short description to your support or IT team.

The diagnostic report contains no email content and no addresses. Never share your password, not even with support.
