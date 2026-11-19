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
  'Keine Aufgabenlisten gefunden. Ein CalDAV-Konto (z. B. Nextcloud) wird unter Einstellungen › Kalender & Kontakte hinzugefügt.':
    'No task lists found. A CalDAV account (e.g. Nextcloud) is added under Settings › Calendar & contacts.',
  'Offene Aufgaben dieses Geräts in die verbundene Liste übernehmen':
    'Move the open tasks on this device into the connected list',
  // Server messages
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
    'Some tasks could not be synced. The next sync tries again.'
};
