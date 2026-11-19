// English texts of the contact history (mini CRM) and video calls, kept apart from i18n-en.ts to
// limit merge conflicts. Keys are the German source strings (see i18n.ts); checked by
// scripts/check-i18n.mjs.
export const CRM_EN: Record<string, string> = {
  Videocall: 'Video call',
  'Videocall beitreten:': 'Join the video call:',
  'Videocall beitreten': 'Join video call',
  'Videocall starten': 'Start video call',
  'Videocall hinzufügen': 'Add video call',
  Videocalls: 'Video calls',
  'Link kopiert.': 'Link copied.',
  'Link kopieren': 'Copy link',
  'Jitsi-Server': 'Jitsi server',
  'Leer lassen für den Standard: {server}': 'Leave empty for the default: {server}',
  'Standard verwenden': 'Use default',
  'Neue Links verwenden: {server}': 'New links use: {server}',
  'Levuvo Mail erstellt Links für Videocalls mit Jitsi Meet, mit einem zufälligen Raumnamen, den niemand erraten kann. Der Call selbst läuft im Browser. Standard ist ein Server in Deutschland (Freifunk München); du kannst auch einen eigenen Jitsi-Server eintragen.':
    'Levuvo Mail creates video call links with Jitsi Meet, with a random room name that nobody can guess. The call itself runs in the browser. The default is a server in Germany (Freifunk München); you can also enter your own Jitsi server.',
  'Bitte eine gültige Adresse des Jitsi-Servers eingeben.': 'Please enter a valid address of the Jitsi server.',
  'Der Jitsi-Server muss mit https:// erreichbar sein.': 'The Jitsi server must be reachable over https://.',
  'Bitte nur die Adresse des Servers angeben, ohne Zugangsdaten oder Parameter.':
    'Please enter only the address of the server, without credentials or parameters.',
  'Die Notiz wird von diesem Gerät gelöscht.': 'The note is deleted from this device.',
  'Notiz bearbeiten': 'Edit note',
  'Notiz zu {name} …': 'Note about {name} …',
  'Notiz speichern': 'Save note',
  'Aufgabe zu {name} …': 'Task about {name} …',
  'Aufgabe anlegen': 'Add task',
  'Notizen und Aufgaben': 'Notes and tasks',
  Alles: 'Everything',
  'E-Mails': 'Emails',
  Verlauf: 'History',
  'Nur auf diesem Gerät: Notizen werden verschlüsselt gespeichert, E-Mails kommen aus dem lokalen Suchindex.':
    'Only on this device: notes are stored encrypted, emails come from the local search index.',
  'Verlauf filtern': 'Filter history',
  'Noch nichts im Verlauf.': 'Nothing in the history yet.',
  'Notizen zu diesem Kontakt auf diesem Gerät werden ebenfalls gelöscht.':
    'Notes about this contact on this device are deleted as well.',
  'Die Notizen zu Kontakten sind gerade nicht verfügbar.': 'Contact notes are not available right now.',
  'Die Notizen zu Kontakten brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.':
    "Contact notes need the system keychain. It isn't available right now.",
  'Die Notizen zu Kontakten lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.':
    'The contact notes cannot be opened with the key from the keychain.',
  'Ungültige Notiz.': 'Invalid note.',
  'Die Notiz ist leer.': 'The note is empty.',
  'Die Notiz gibt es nicht mehr.': 'The note no longer exists.',
  'Eine Notiz darf höchstens 5000 Zeichen haben.': 'A note can have at most 5000 characters.',
  'Höchstens 500 Notizen pro Kontakt.': 'At most 500 notes per contact.',
  'Es sind schon zu viele Notizen gespeichert.': 'Too many notes are already stored.',
  'Verschlüsselt (AES-256-GCM, Schlüssel im Schlüsselbund): Aufgaben, Kontakte und Kalender auf diesem Gerät sowie die Notizen im Kontaktverlauf.':
    'Encrypted (AES-256-GCM, key in the keychain): tasks, contacts and calendar on this device and the notes of the contact history.',
  'Ungültiger Verweis auf den Kontakt.': 'Invalid reference to the contact.'
};
