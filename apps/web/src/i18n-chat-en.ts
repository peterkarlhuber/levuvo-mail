// English texts of the chat in shared spaces, kept apart from i18n-en.ts to limit merge
// conflicts. Keys are the German source strings (see i18n.ts); checked by scripts/check-i18n.mjs.
export const CHAT_EN: Record<string, string> = {
  Chat: 'Chat',
  'Ende-zu-Ende-verschlüsselt über eure Postfächer. Nachrichten kommen meist innerhalb weniger Sekunden an. Es gibt keine Lesebestätigungen.':
    'End-to-end encrypted through your mailboxes. Messages usually arrive within a few seconds. There are no read receipts.',
  'Ältere Nachrichten laden': 'Load older messages',
  'Noch keine Nachrichten. Schreib die erste.': 'No messages yet. Write the first one.',
  'Noch keine Nachrichten.': 'No messages yet.',
  Neu: 'New',
  'Mit dem Assistenten geschrieben': 'Written with the assistant',
  'KI-erstellt': 'AI-generated',
  Antworten: 'Reply',
  'Nachricht löschen?': 'Delete message?',
  'Die Nachricht wird für alle Mitglieder gelöscht, auch aus ihren Kopien des Raums.':
    'The message is deleted for all members, including from their copies of the space.',
  'Nachricht gelöscht': 'Message deleted',
  'Wird zugestellt …': 'Delivering …',
  'Nachricht bearbeiten': 'Edit message',
  'Antwort an {name}: „{text}“': 'Reply to {name}: “{text}”',
  Nachricht: 'Message',
  'Nachricht an alle Mitglieder (Enter sendet, Umschalt+Enter für neue Zeile)':
    'Message to all members (Enter sends, Shift+Enter for a new line)',
  'Als Leser kannst du mitlesen, aber nicht schreiben.': 'As a reader you can follow along but not write.',
  'Dieser Raum ist nicht mehr aktiv.': 'This space is no longer active.',
  '{n} ungelesene Chat-Nachrichten': '{n} unread chat messages',
  'ungelesene Nachrichten': 'unread messages',
  'Nachricht im Chat senden': 'Send a chat message',
  'Nur diese': 'Only this one',
  'Für diesen Raum bis auf Widerruf': 'For this space until revoked',
  'Für diesen Raum bis auf Widerruf freigeben: {title}': 'Approve for this space until revoked: {title}',
  'Der Assistent darf in diesem Raum ab jetzt ohne Rückfrage im Chat schreiben. Zurücknehmen in den Einstellungen des Raums.':
    'From now on the assistant may write in the chat of this space without asking. Revoke it in the space settings.',
  'Erlaubt bis auf Widerruf.': 'Allowed until revoked.',
  'Zurückgenommen.': 'Revoked.',
  'Erlaubt seit {date}': 'Allowed since {date}',
  'Im Chat ohne Rückfrage schreiben': 'Write in the chat without asking',
  'Bis auf Widerruf, nur auf diesem Gerät, höchstens 10 Nachrichten in 10 Minuten. Seine Nachrichten sind für alle als „KI-erstellt“ markiert.':
    'Until revoked, only on this device, at most 10 messages in 10 minutes. Its messages are marked “AI-generated” for everyone.'
};
