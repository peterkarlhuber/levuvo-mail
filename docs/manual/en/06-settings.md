# Settings, security and help

## The settings at a glance

Open the settings with the slider icon at the bottom left or with `Alt` + `,`.

![Settings, General section](settings-general.png)

| Section | What you set there |
|---|---|
| General | **Display** (language, theme, density), **Reading** (bundles, review new senders), **Writing** (undo send), **Calendar**, **Video calls** (Jitsi server) |
| Accounts | Accounts, signatures, sender addresses, **Connection status** |
| Templates | **Snippets and templates** |
| Filters & vacation | **Filter rules** on the mail server and **Vacation reply** |
| Automations | **Automations**: rules for new email, also creating tasks, with a **Log** |
| Calendar & contacts | **Server accounts** of other providers, colours, import and export |
| Booking links | **Booking links** others use to book a meeting with you |
| Security | Keys and certificates (OpenPGP, S/MIME) |
| Search & offline | Status of the search index, rebuild |
| AI & agents | **AI assistant**, **Features**, **Writing style**, **AI log**, agents and **Approvals** |
| Notifications | Allow and test notifications |
| Privacy | Privacy cockpit, **Your data**, crash reports, diagnostic report, **Data stored on this device** |
| Backup | **Create backup**, **Restore or move to a new computer** |
| Help | **Manual** (this guide) with search, **Quick help**, keyboard shortcuts |
| About | Version, **Security and support**, **Legal notice**, open-source licences |

### Signature and additional sender addresses

Under **Settings → Accounts**, click an account to edit it. There you create a **Signature**, also with links and a small logo. Under **Additional sender addresses (aliases)** you add more addresses, such as office@ and invoices@, each with its own signature. Only add addresses your mail server lets you send from.

![Accounts and signatures](settings-accounts.png)

### Automations

Under **Settings → Automations**, **New automation** creates rules for new email in the inbox: for example move a sender's emails to a folder, mark them as read, star them or **create a task**. With the assistant on, you **describe the rule in plain words** and choose **Suggest rule**. The local AI then fills in the editor, and the proposal is marked as an AI proposal. Check it, because the AI can be wrong.

**How the rule runs** shows the rule in words. **Dry run** shows which of the 50 newest emails it would handle, without changing anything. A rule only runs once you switch it on, and only for email that arrives afterwards. It never deletes, never replies and never moves to the trash. The **Log** shows what the rules did.

## How Levuvo Mail protects your data

- **Everything stays on your computer.** There is no Levuvo Mail server your email passes through. Your email only goes to your mail provider's servers. Levuvo Mail doesn't record how you use the app.
- **Passwords in the secure store.** Account passwords and keys are kept in the Keychain (Mac) or the Credential Manager (Windows), never in a plain file.
- **Local data encrypted.** The search index, local calendars, contacts, tasks and spaces are encrypted on disk.
- **Safe display.** Emails are shown without scripts, external images are blocked and links ask first.
- **Only reachable from your device.** The app doesn't accept connections from other computers.
- **Crash reports only if you want.** Under **Settings → Privacy** you decide whether a technical report is sent after a crash. It may contain parts of open emails or addresses. That is why it is off by default.

### Export or delete your data

Under **Settings → Privacy** the **Privacy cockpit** shows the last 30 days: blocked trackers, AI calls and what left your computer. Below it, under **Your data**:

- **Export my data** saves a readable copy (JSON) of the data that exists only on this device., without passwords and private keys.
- **Delete all data on this device** removes everything Levuvo Mail stored here at the next start, including its entries in the Keychain or Credential Manager. Until then you can cancel; emails on the servers stay.
- **Install updates automatically** is on. If you switch it off, Levuvo Mail asks before each update. Then please install security updates promptly.

Under **Settings → About**, **Security and support** shows until when this version gets free security updates and how to report a vulnerability. **Open-source licences** shows the licence texts of all included components.

![Security: keys and certificates](settings-security.png)

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

This manual is also in the app, with search: **Settings → Help** or the question mark on the left. Or ask the assistant, for example "How do I make a backup?"; it answers from the manual.

If you are still stuck:

1. Open **Settings → Privacy** and click **Download** next to **Diagnostic report**. It contains no email content and no addresses.
2. Send it with a short description to your support or IT team. Never share your password, not even with support.
