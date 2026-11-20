# Email

## Read messages

Click a message in the list and it appears on the right in the reading pane. Use `J` and `K` to go to the next or previous message.

- **Images from the internet** are blocked at first, so senders can't see when you open their email. **Load images** shows them for this one message.
- **Links** ask before opening and show you the real destination. That way you spot fake links.
- **Attachments** are listed below the message. The eye opens a preview, the arrow downloads the file. Dangerous file types, such as programs, are marked and need a confirmation.
- **Conversation:** If the email belongs to a longer exchange, the **Conversation** box shows all its messages, including your own replies.
- **Unsubscribe from newsletters:** With newsletters, **Unsubscribe** appears above the text. Levuvo Mail always asks before it unsubscribes you.

Under **…** (more actions) you can print a message or save it as a PDF.

## Write and reply

Click **New message** or press `N`. To answer, use **Reply** (`R`), **Reply all** (`A`) or **Forward** (`F`).

![Writing a reply](composer.png)

1. **From:** Choose the sender address if you have several. The matching signature is added automatically.
2. **To:** Type a name or an address. Levuvo Mail suggests contacts. **CC/BCC** adds more recipients. BCC recipients can't see the others.
3. Enter the **Subject** and the text. The bar above the text formats it (bold, lists, links, images).
4. **Attachments:** Click **Choose files** or drag files into the window. Up to eight files with 8 MiB (about 8 MB) in total are allowed.
5. Click **Send** or press `Ctrl` + `Enter`.

Drafts are saved automatically while you write. **Close as draft** keeps the message in **Drafts**.

### Undo send

After sending, "Sending in 10 s" with **Undo** shows briefly at the bottom. Clicking it brings the message back into the editor. How long you have is set under **Settings → General**: off, 5, 10 (default), 20 or 30 seconds.

### Send later

Click the small arrow next to **Send** and choose a time, such as **Tomorrow morning**, or your own date. Until then the message waits in **Drafts**. Levuvo Mail has to be running at that time; running in the background is enough. Otherwise the message goes out at the next start.

### Get reminded about a reply

At the bottom left of the editor choose, for example, **Follow up after 3 days**. If no reply arrives by then, the message shows up in the folder bar under **Follow-up** and you get a notification. If the recipient replies before that, the reminder disappears by itself.

### Templates for recurring texts

**Templates** inserts saved texts or saves the current message as a template. Placeholders such as `{FirstName}` or `{Date}` are filled in automatically. You manage templates under **Settings → Templates**.

### Hints before sending

Before an email goes out, Levuvo Mail checks it on your computer, without AI. If many external recipients from several organizations would see each other's addresses, it suggests **Bcc**. If card numbers, social security numbers, passwords or health data would leave unencrypted, it points that out. With the assistant switched on, the check also spots discriminatory wording and threats. You decide whether to send anyway; nothing of this is stored or reported. The hints are not legal advice.

## Keep things tidy

| What you want to do | How |
|---|---|
| Mark as important | Click the star or press `S` |
| Put away what's done | Archive icon or `E` |
| Delete | Trash icon or `Del` |
| Report as spam | Shield icon or `!` |
| Put in a folder | **Move …** in the reading pane, or drag it onto the folder |
| Bring back later | Alarm clock icon or `B`, then choose a time |
| Handle many at once | Tick the messages, then choose the action at the top |

After archiving, deleting, moving, spam, snoozing and bulk actions, **Undo** appears at the bottom. One click reverses the action straight away.

**Snooze** takes an email out of the inbox and puts it back, unread, at the time you choose, for example "Monday morning". Until then it waits in the **Snoozed** folder.

**Create folders:** Click **New folder** below the folder list. Right-click a folder to rename it, add a subfolder or delete it. Only empty folders can be deleted.

## Search

Press `/` or click into the search field above the list. It searches subject, sender and text in the current folder.

With the **Everywhere** switch next to it you search all folders and accounts at once, even without internet. For this, Levuvo Mail keeps an encrypted directory of your emails in the background, the search index. You see its status under **Settings → Search & offline**.

**Without internet** Levuvo Mail keeps showing the messages it loaded last. Moving and sending work again once the connection is back.

## Review new senders first

If you like, email from strangers doesn't go straight into the inbox. A stranger is someone who isn't in your contacts and whom you have never written to.

1. Under **Settings → General**, switch on **Review new senders first**. It applies to email that arrives from then on.
2. Email from new senders collects at the top of the list under **New senders**.
3. Open that row and decide for each sender: **Accept** lets their future emails through, **Block** moves their emails to the spam folder.

![Accept or block new senders](screening.png)

## Bundles and the attachment overview

**Bundles** group newsletters, invoices, notifications and the like into one row each. That keeps the inbox clear. If the AI assistant is on with a local model, it helps to sort them. You switch bundles on and off under **Settings → General → Bundle the inbox**.

The **attachment overview** (in the folder bar under **Attachments**) shows all files in a folder at a glance. Handy when you are looking for a particular PDF.

## Filters and vacation reply

Under **Settings → Filters & vacation** you set up rules, for example "emails from invoice@supplier.com into the Accounting folder". The rules run directly on your mail server, so they also work when Levuvo Mail is closed.

- **Vacation reply:** switch it on, enter the period, subject and text, save. You format the text like the signature (bold, links, images). **Append the account's signature (with logo)** adds your signature. If you change the signature later, save the vacation reply again.
- **Rules:** Click **Add rule**, choose a condition (From, To/CC, Subject …) and an action (move, mark as read …), and click **Save on the server**.

This works if your provider offers server filters (the technical term is Sieve or ManageSieve). The logo then travels inside the reply. If your mail server can only send plain text, Levuvo Mail saves the reply as text and tells you.

**Microsoft 365 and Gmail:** here Levuvo Mail stores the vacation reply directly with Microsoft or Google. You also choose who gets a reply (everyone, only contacts, only your organization). The first time, click **Approve** and confirm on the provider's sign-in page. Neither provider keeps embedded images, so the logo is left out there. For these accounts, set up rules in the provider's webmail.

## Encrypt confidential messages

### Protect with password

This works for every recipient, without them setting anything up. Suitable for contracts, login details or personal documents.

1. While writing, choose **Protect with password** in the **No encryption** field.
2. Levuvo Mail suggests a strong password. You can keep it or change it (at least 10 characters). Text and attachments together may be at most 5 MiB.
3. Click **Send**.
4. Tell the recipient the password another way, for example by text message or phone. Never in the same email.

The recipient gets a file called "Geschuetzte-Nachricht.html". They open it in their browser and enter the password. Only the **subject** stays readable for everyone, so don't put anything confidential there.

### OpenPGP and S/MIME

These are two widespread standards for encrypted and signed email. They make sense if you regularly write confidentially with the same partners and they also use OpenPGP (for example Thunderbird) or S/MIME (for example Outlook).

- **OpenPGP:** Under **Settings → Security**, create a key, send its public part to your contacts and import their keys.
- **S/MIME:** Import a certificate from a certificate authority as a `.p12` or `.pfx` file.

When writing, you then choose **Sign** (proves the email is from you) and **Encrypt** (only the recipient can read it).

## Protection against fraud (phishing)

Levuvo Mail checks every message and warns clearly, for example when

- the sender might be forged,
- a link shows something other than what it opens,
- an attachment might contain a program.

If **No issues detected** is shown below the sender, nothing suspicious was detected. A warning is a strong hint, not proof. When in doubt: don't enter passwords, don't pay anything, and ask the sender another way, for example by phone.
