// English texts of the privacy cockpit, the newsletter hub and password-protected sending, kept
// apart from i18n-en.ts to limit merge conflicts. Keys are the German source strings (see i18n.ts);
// checked by scripts/check-i18n.mjs.
export const PRIVACY_EN: Record<string, string> = {
  'Dieses Passwort ist zu leicht zu erraten. Bitte das vorgeschlagene Passwort verwenden oder ein anderes wählen.':
    'This password is too easy to guess. Please use the suggested password or choose another one.',
  'Zu leicht zu erraten': 'Too easy to guess',
  'Passwort kopiert. Es wird nach einer Minute aus der Zwischenablage entfernt.':
    'Password copied. It will be removed from the clipboard after one minute.'
};
