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

### Invitations

- **Invite:** Enter the attendees' email addresses in the event and choose **Send invitation by email**. Outlook, Apple Calendar and Google understand the invitation too.
- **Receiving an invitation:** A card with **Accept**, **Maybe** and **Decline** appears in the email. Your answer goes to the organizer and the event lands in your calendar.

Reminders appear as notifications from your computer, even when the window is closed.

## Contacts

Open contacts with `Alt` + `3`.

![Contacts with an open contact card](contacts.png)

- **New contact:** Click **+**, enter the name, email addresses, phone numbers and other details, and save.
- **Write email** opens a new message to the contact straight away.
- **Import and export:** The arrow icons above the list read a `.vcf` file (for example from Outlook or Google) or save all contacts as a file.

Contacts from Microsoft 365 and Google appear automatically once you allowed access. Local contacts stay encrypted on this computer.

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

## My day

The first time you open Levuvo Mail on a day, it shows **My day**: an overview of everything that is on today.

- **Today’s events** with place and number of attendees.
- **Tasks for today**, overdue ones too. Tick them off right there with the circle.
- **Waiting for your answer:** emails from people from the last three days that you have not answered yet. Newsletters and automatic emails are left out.
- **No answer received:** sent emails whose follow-up is due.
- **Promises:** suggestions of the promise tracker (see the chapter "AI assistant"), if it is switched on.
- **New in your spaces** and open invitations.

Click an entry to open the email, the calendar or the tasks. The overview is put together on this computer, without any AI. With the assistant on, **Sort with AI: what needs an answer today?** orders the waiting emails by importance. The AI only changes the order, it hides nothing, and the result is labelled **Order AI-generated**.

**My day** only appears when there is something to show. You can open it at any time from the command palette (`Ctrl` + `K`, **My day: overview for today**). Switch it off in the window itself or under **Settings → General → Reading** with **Show “My day” when first opened each day**.

## Meeting preparation

Shortly before an event with other people, a **Meeting preparation** card appears at the bottom right. It shows:

- the **attendees** with their address book entry and whether they accepted,
- the **Latest emails** with them or about the topic of the event,
- **files**: attachments of the event and of these emails,
- **Open points**: tasks, emails without an answer and promises that involve these people.

Click to open an email. With the assistant on, **What is it about? Summarize with AI** summarizes the emails. The summary is labelled as an AI result. The card covers nothing and closes with `Esc`.

Under **Settings → General → Reading**, **Meeting preparation** sets when the card appears: 5, 10 or 15 minutes before, or **Off**. You can open it for the next event at any time from the command palette with **Prepare the next meeting**.
