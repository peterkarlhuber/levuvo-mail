# Getting started

## Install Levuvo Mail

Download the right file for your computer. Only take it from a trusted source, for example directly from your IT team.

| Computer | File |
|---|---|
| Mac with Apple chip (M1 and later) | `Levuvo-Mail-…-arm64.dmg` |
| Windows PC (most devices) | `Levuvo-Mail-Setup-…-x64.exe` |
| Windows PC with an ARM chip (e.g. Snapdragon) | `Levuvo-Mail-Setup-…-arm64.exe` |

Macs with an Intel chip are not supported.

### On a Mac

1. Double-click the downloaded `.dmg` file.
2. Drag **Levuvo Mail** into the **Applications** folder.
3. Start Levuvo Mail from the **Applications** folder.

### On Windows

1. Double-click the downloaded `Setup` file.
2. Follow the steps of the installer. You don't need administrator rights.
3. Levuvo Mail then starts by itself and is in the Start menu.

### Warning when you open it for the first time

The current installation files are not yet signed with a certificate from Apple or Microsoft. That is why your computer shows a warning the first time. This is normal for this version.

**Mac:** You see that "Levuvo Mail" cannot be opened because Apple could not check it.

1. Click **Done** (not "Move to Trash").
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the **Security** section. There is a note about Levuvo Mail. Click **Open Anyway**.
4. Confirm with your Mac password or Touch ID and click **Open Anyway** once more.

From then on Levuvo Mail starts without asking.

**Windows:** A blue window appears: "Windows protected your PC" (Microsoft Defender SmartScreen).

1. Click **More info**.
2. Check that the app shown is `Levuvo-Mail-Setup-…`.
3. Click **Run anyway**.

> **Important:** Don't switch off your virus protection or SmartScreen for this. The exception only applies to this one file.

Unsigned versions don't update themselves. To get a new version, simply install it over the old one. Your data is kept.

## Set up your email account

When you start Levuvo Mail for the first time, it asks for your email account. You add more accounts later under **Settings → Accounts → Add account**, up to five.

![On first start you set up your account.](onboarding.png)

1. Choose your **Provider**, for example Microsoft 365, Gmail, GMX, WEB.DE, IONOS, Hetzner or Strato. If yours isn't listed, choose **Other provider**.
2. Enter your **Email address** and your **Password**. Optionally add an account name (such as "Work") and your name as sender.
3. Click **Set up account**. Levuvo Mail first checks that receiving and sending work, and only then saves. If the server can't be reached right now, you can continue with **Save anyway and verify later**.

Your password is then kept in your computer's secure password store: the Keychain on a Mac, the Credential Manager on Windows.

**Microsoft 365 and Outlook.com:** These accounts only work with **Sign in with Microsoft**, not with a password. Your browser opens, you sign in there and the app takes over the account. Calendars and contacts come along too. If the button is missing, contact your IT team.

**Gmail:** Use **Sign in with Google** if the button is there. Otherwise you need an **app password**. That is a separate password just for Levuvo Mail. You create it in your Google account under **Security → 2-Step Verification → App passwords**. 2-Step Verification has to be switched on for this.

**Other provider:** Here you need your provider's server addresses. They usually call them "IMAP" (for receiving, port 993) and "SMTP" (for sending, port 465 or 587). You find them in your provider's help pages. Click **Show server settings** and enter them there.

> **Tip:** "Remove" on an account only deletes its setup on this computer. Your emails on the server stay untouched.

## The app at a glance

![Inbox with an open message](mail.png)

- **Left bar:** switches between email, calendar, contacts, spaces and tasks. At the bottom you find the assistant (sparkle icon ✦), the command palette (`⌘` icon), help (question mark) and settings (slider icon).
- **Folder bar:** Inbox, Drafts, Sent, Archive and your own folders. At the very bottom you switch accounts.
- **Message list:** all messages in the chosen folder. At the top you filter by **Unread**, **Starred** or **Attachment**.
- **Reading pane:** the open message with all its actions.

Next to the folder name a small badge shows the connection: **Live** means new mail appears straight away. **Connecting …** means the connection is being set up. **Offline** means you are working without internet. **Disrupted** means the mail server isn't answering properly (see chapter 6).

### Reach everything with one search

Press `Ctrl` + `K`. The command palette opens. Type a few letters, such as "dra" for Drafts or "new" for a new message, and press `Enter`. This takes you to any folder, account or setting without hunting for it.

![The command palette finds folders, commands and settings.](palette.png)

### Levuvo Mail in the background

When you close the window, Levuvo Mail keeps running in the background. That way you get notifications about new mail and events, and scheduled messages go out on time. To quit completely, use the icon in the menu bar (Mac) or in the notification area next to the clock (Windows): click the icon and choose **Quit**.

## Make a backup

Some data only lives on your computer, for example your settings, local calendars and contacts, tasks, templates and spaces. So make a backup right at the start and repeat it regularly.

![Create and restore a backup](settings-backup.png)

1. Open **Settings → Backup**.
2. Under **Create backup**, choose a password with at least 12 characters and repeat it. The file is encrypted with it.
3. Click **Save backup** and keep the file in a safe place, for example on a USB stick.

For security, your account passwords are not in the backup. You enter them once more after restoring.

**Move to a new computer:** Install Levuvo Mail on the new device. In the welcome window, click **Moving from another computer? Restore a backup**, choose the backup file and enter its password. Then click **Restart now** and the data is applied.

> **Important:** Keep the backup and its password as carefully as the computer itself. Without the password the file cannot be opened.
