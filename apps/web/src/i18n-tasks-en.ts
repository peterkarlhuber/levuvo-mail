// English texts of the task sync (connected lists), kept apart from i18n-en.ts to limit merge
// conflicts. Keys are the German source strings (see i18n.ts); checked by scripts/check-i18n.mjs.
export const TASKS_EN: Record<string, string> = {
  Liste: 'List',
  Listen: 'Lists',
  CalDAV: 'CalDAV',
  'Microsoft To Do': 'Microsoft To Do',
  'Google Tasks': 'Google Tasks',
  'Alle Listen': 'All lists',
  'Liste verbinden': 'Connect a list',
  'Jetzt abgleichen': 'Sync now',
  'Fehler beim Abgleich': 'Sync error',
  'Abgleich mit Fehlern. Details stehen bei der Liste.': 'Synced with errors. Details are shown with the list.',
  'Abgeglichen. {count} gleichzeitige Änderungen: jeweils die neuere wurde übernommen.':
    'Synced. {count} simultaneous changes: the newer one was kept each time.',
  'Aufgaben abgeglichen.': 'Tasks synced.',
  '„{name}“ ist verbunden. {count} Aufgaben übernommen.': '“{name}” is connected. {count} tasks taken over.',
  'Liste trennen?': 'Disconnect list?',
  'Die Aufgaben aus „{name}“ bleiben auf diesem Gerät. Auf dem Server wird nichts gelöscht, es wird nur nicht mehr abgeglichen.':
    'The tasks from “{name}” stay on this device. Nothing is deleted on the server, it is just no longer synced.',
  Trennen: 'Disconnect',
  Fertig: 'Done',
  'Aufgabenliste verbinden': 'Connect a task list',
  Aufgabenlisten: 'Task lists',
  'Abgeglichen werden Titel, Notiz, Fälligkeit, Erinnerung, Priorität, Wiederholung und der Status. Der Link zur E-Mail bleibt auf diesem Gerät.':
    'Title, note, due date, reminder, priority, repetition and status are synced. The link to the email stays on this device.',
  'Keine Aufgabenlisten gefunden. Aufgabenlisten kommen von CalDAV-Konten (z. B. Nextcloud, unter Einstellungen › Kalender & Kontakte) und von Microsoft-365- oder Google-Konten, die mit dem Anbieter angemeldet sind.':
    'No task lists found. Task lists come from CalDAV accounts (e.g. Nextcloud, under Settings › Calendar & contacts) and from Microsoft 365 or Google accounts signed in with the provider.',
  'Offene Aufgaben dieses Geräts in die verbundene Liste übernehmen':
    'Move the open tasks on this device into the connected list',
  // Server messages
  'Für die Aufgaben dieses Kontos ist eine einmalige Freigabe beim Anbieter nötig.':
    'The tasks of this account need a one-time consent at the provider.',
  'Der Anbieter verweist auf eine fremde Adresse.': 'The provider points to a foreign address.',
  'Der Aufgabendienst des Anbieters ist nicht erreichbar.': 'The provider’s task service cannot be reached.',
  'Die Aufgabe oder Liste gibt es beim Anbieter nicht mehr.': 'The task or list no longer exists at the provider.',
  'Die Aufgabe wurde beim Anbieter geändert.': 'The task was changed at the provider.',
  'Das Konto gibt es nicht mehr.': 'The account no longer exists.',
  'Ohne Titel': 'Untitled',
  'Diese Liste gibt es auf dem Server nicht.': 'This list does not exist on the server.',
  'Die Aufgabe auf dem Server lässt sich nicht lesen.': 'The task on the server cannot be read.',
  'Das Kalenderkonto gibt es nicht mehr.': 'The calendar account no longer exists.',
  'Der Server verweist auf eine fremde Adresse.': 'The server points to a foreign address.',
  'Die Antwort des Servers ist zu groß.': 'The server’s answer is too large.',
  'Auf dem Server wurde kein Kalenderverzeichnis gefunden.': 'No calendar home was found on the server.',
  'Die Aufgabenlisten ließen sich nicht abrufen.': 'The task lists could not be loaded.',
  'Die Aufgabenliste gibt es auf dem Server nicht mehr.': 'The task list no longer exists on the server.',
  'Der Kalenderserver hat die Anfrage abgelehnt.': 'The calendar server rejected the request.',
  'Der Server hat die Aufgabe abgelehnt, weil sie zu groß ist.':
    'The server rejected the task because it is too large.',
  'Der Kalenderserver hat die Aufgabe abgelehnt.': 'The calendar server rejected the task.',
  'Die Aufgabe wurde auf dem Server geändert.': 'The task was changed on the server.',
  'Die Aufgabe gibt es auf dem Server nicht mehr.': 'The task no longer exists on the server.',
  'Der Kalenderserver hat die Änderung abgelehnt.': 'The calendar server rejected the change.',
  'Der Kalenderserver hat das Löschen abgelehnt.': 'The calendar server rejected the deletion.',
  'Dieser Dienst ist für Aufgaben nicht verfügbar.': 'This service is not available for tasks.',
  'Ungültige Liste.': 'Invalid list.',
  'Diese Liste ist schon verbunden.': 'This list is already connected.',
  'Diese Liste ist nicht verbunden.': 'This list is not connected.',
  'Diese Liste ist nicht mehr verbunden.': 'This list is no longer connected.',
  'Höchstens 10 verbundene Listen.': 'At most 10 connected lists.',
  'Die Liste beim Anbieter ist leer. Zur Sicherheit wurde hier nichts gelöscht.':
    'The list at the provider is empty. To be safe, nothing was deleted here.',
  'Einige Aufgaben ließen sich nicht abgleichen. Der nächste Abgleich versucht es erneut.':
    'Some tasks could not be synced. The next sync tries again.',
  'Die Liste auf dem Server ist zu groß für den Abgleich. Zur Sicherheit wurde nichts geändert.':
    'The list on the server is too large to sync. To be safe, nothing was changed.',
  'Die Liste beim Anbieter ist zu groß für den Abgleich. Zur Sicherheit wurde nichts geändert.':
    'The list at the provider is too large to sync. To be safe, nothing was changed.',
  'Der Anbieter hat eine unerwartete Antwort geschickt.': 'The provider sent an unexpected answer.',
  'Unerwartete Antwort des Anbieters.': 'Unexpected answer from the provider.',
  // Space tasks in the main area
  'Kein Raum': 'No space',
  'Aufgabe in den Raum verschoben.': 'Task moved to the space.',
  'Aufgabe aus dem Raum „{name}“': 'Task from the space “{name}”',
  'Mir zugewiesene Aufgaben aus dem Raum „{name}“': 'Tasks assigned to me in the space “{name}”',
  'Nur lesen: In diesem Raum hast du die Rolle Leser.': 'Read only: your role in this space is reader.',
  '„{title}“ wird im Raum „{space}“ für alle Mitglieder gelöscht.':
    '“{title}” will be deleted in the space “{space}” for all members.',
  'Änderungen gehen verschlüsselt an alle Mitglieder des Raums.': 'Changes go encrypted to all members of the space.',
  'Die Aufgabe wird in den Raum verschoben und dir zugewiesen. Alle Mitglieder sehen sie. Erinnerung, Wiederholung, Liste und der Link zur E-Mail entfallen.':
    'The task moves to the space and is assigned to you. All members see it. Reminder, repetition, list and the link to the email are dropped.',
  'Die Aufgabe wird im Raum angelegt und dir zugewiesen. Alle Mitglieder sehen sie.':
    'The task is created in the space and assigned to you. All members see it.',
  'Ungültiges Feld: Titel.': 'Invalid field: title.',
  'Ungültiges Feld: Notiz.': 'Invalid field: note.',
  'Eine Raum-Aufgabe bleibt in ihrem Raum.': 'A space task stays in its space.',
  'Räume sind gerade nicht verfügbar.': 'Spaces are not available right now.',
  'In diesem Raum darfst du keine Aufgaben anlegen.': 'You may not add tasks in this space.'
};
