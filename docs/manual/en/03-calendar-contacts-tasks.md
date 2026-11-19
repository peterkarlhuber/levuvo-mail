# Calendar, contacts and tasks

## Calendar

Open the calendar from the left bar or with `Alt` + `2`.

![The calendar's week view](calendar.png)

### Which calendars you see

- **On this device:** This calendar works straight away and without an account. Events stay encrypted on your computer and don't appear on your phone.
- **Microsoft 365 and Google:** If you signed in with Microsoft or Google, your calendars come along automatically. If **Allow access** appears once, click it and confirm in the browser with the same account.
- **Other providers** such as Nextcloud, mailbox.org or iCloud: Click **Connect calendar** on the left and enter the server address, your user name and an app password. The technical term for this is CalDAV. Levuvo Mail has presets for the well-known providers.

### Create and change events

1. Click **New event** or an empty slot in the week.
2. Enter a title, start and end, and optionally a location, description and a reminder.
3. For a recurring event, choose for example **Weekly** under **Repeat**.
4. Click **Save**.

To **move** an event, drag it with the mouse to another place. If the event has attendees, Levuvo Mail asks whether to let them know.

At the top right you switch between **Day**, **Week**, **Month** and **Agenda** (a list of upcoming events). **Today** jumps to the current day.

### Video calls

An event can get a video call. Levuvo Mail uses Jitsi Meet for it, which runs in the browser without an account.

1. Open the event and click **Add video call** below **Location**.
2. Levuvo Mail enters a link with a random room name that nobody can guess. If the location is already set, for example to a meeting room, the link goes in the first line of the description.
3. Save the event. All attendees get the link with the invitation.

An event with a video call shows **Join video call** and **Copy link**. The call opens in the browser; Levuvo Mail asks first, as for every link.

The default server is meet.ffmuc.net, run by Freifunk München in Germany. Enter your own Jitsi server under **Settings → General → Video calls**. Everyone who has the link can join, so share it only with the people who should be there.

### Invitations

- **Invite:** Enter the attendees' email addresses in the event and choose **Send invitation by email**. Outlook, Apple Calendar and Google understand the invitation too.
- **Receiving an invitation:** A card with **Accept**, **Maybe** and **Decline** appears in the email. Your answer goes to the organizer and the event lands in your calendar.

Reminders appear as notifications from your computer, even when the window is closed.

### Find a time and polls

With **Find a time** in the calendar toolbar you look for a time when everyone can make it. Enter the people, the duration, the period and the hours and choose **Find free times**. Levuvo Mail checks your own calendars and, where possible, the free/busy of colleagues in Microsoft 365 or Google. It only reads start and end, never titles. Then you have three options:

- **Enter event and invite:** Pick one time; the event is created and everyone gets an invitation.
- **Let the team vote:** Pick up to 8 times. Everyone gets their own email with one link per time and answers with one click from their own mail program. Under **Polls** in the calendar sidebar you see who can when, and **Set** enters the event and invites everyone.
- **Offer times to someone outside:** The first time someone picks is booked at once.

### Booking links

Under **Settings → Booking links** you create a link for your signature or website. Whoever clicks it writes you an email, and Levuvo Mail answers automatically with free times from your calendars. A click on a time books it, and both of you get an invitation. You choose the duration, weekdays, hours, notice and buffer. It works without a server of your own while Levuvo Mail is open. Levuvo Mail never answers automatic emails such as out-of-office replies.

## Contacts

Open contacts with `Alt` + `3`.

![Contacts with an open contact card](contacts.png)

- **New contact:** Click **+**, enter the name, email addresses, phone numbers and other details, and save.
- **Write email** opens a new message to the contact straight away.
- **Import and export:** The arrow icons above the list read a `.vcf` file (for example from Outlook or Google) or save all contacts as a file.

Contacts from Microsoft 365 and Google appear automatically once you allowed access. Local contacts stay encrypted on this computer.

### Contact history

Below a contact's details, **History** shows everything about the person on one timeline: emails from all accounts and folders, shared events, tasks and your notes.

- **Save note:** record what was discussed. Edit a note with the pencil and delete it with the bin.
- **Add task:** the task belongs to this person and also appears under Tasks. Tasks you made from one of the person's emails show up as well.
- **Filter:** **Everything**, **Emails**, **Events**, **Tasks** and **Notes** hide the rest. Click an email to open it.

You also see notes and open tasks while reading: click the sender to open the contact card. You can add notes and tasks there too, also for people who are not in an address book.

The history stays on this computer. Notes are stored encrypted and are part of the backup. Nothing is looked up online and no AI is used. Deleting the last contact with an address also deletes the notes about it.

## Tasks

Open tasks with `Alt` + `5`. On the left you choose the view: **Today**, **Upcoming**, **Overdue**, **All open** or **Done**.

![Open tasks with due dates and priority](tasks.png)

- **Add quickly:** Type into the **Add a task …** field at the top and press `Enter`.
- **In detail:** **New task** opens a window for due date, reminder, priority, notes and repeat.
- **From an email:** Click the task icon (**Create task**) in the reading pane. The task remembers the email, so you get back to it with one click.
- **Done:** Click the circle in front of the task.

**Sync with other lists:** **Connect a list** links Microsoft To Do, Google Tasks or a CalDAV list. Then you see your tasks on your phone too. Disconnecting only ends the sync; nothing is deleted on the server.

**Tasks from spaces:** Space tasks assigned to you also show here, with the space's name. Under **Spaces** on the left you filter by space. Complete them or change title, note, due date and priority here or in the space: the change applies everywhere and goes encrypted to all members. If you are a reader in the space, you only see the task.

**Move a task into a space:** In a task, pick a space under **Space** where you are owner or editor. The task moves into the space, is assigned to you, and all members see it. Reminder, repeat, list and the link to the email are dropped. Space tasks are never synced with Microsoft To Do, Google Tasks or CalDAV; if the task was in a connected list, it is deleted there.
