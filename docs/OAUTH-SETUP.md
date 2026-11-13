# „Mit Microsoft anmelden“ und „Mit Google anmelden“ freischalten

Levuvo Mail enthält die komplette OAuth-2.0-Anmeldung (Authorization Code mit PKCE, Rückleitung an
`http://127.0.0.1:<Port>/oauth/callback`, IMAP/SMTP über XOAUTH2, Erneuerungstoken im Schlüsselbund).
Damit die Schaltflächen erscheinen, braucht der Build eine **Client-ID je Anbieter**. Diese
Registrierung kann nur Levuvo als Herausgeber vornehmen.

Eintragen in `package.json` (wird in die App eingebaut):

```json
"levuvo": {
  "oauth": {
    "microsoft": { "clientId": "00000000-0000-0000-0000-000000000000" },
    "google": { "clientId": "….apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
  }
}
```

Für lokale Tests alternativ als Umgebungsvariablen: `LEVUVO_OAUTH_MICROSOFT_CLIENT_ID`,
`LEVUVO_OAUTH_GOOGLE_CLIENT_ID`, `LEVUVO_OAUTH_GOOGLE_CLIENT_SECRET`.

Bei Desktop-Apps sind Client-ID und (bei Google) das „Client-Secret“ **nicht geheim** – sie stecken
in jeder installierten App. Die Sicherheit kommt von PKCE und der lokalen Rückleitung.

## Microsoft 365 / Outlook.com (Microsoft Entra ID)

1. <https://entra.microsoft.com> → **App-Registrierungen** → **Neue Registrierung**.
2. Name „Levuvo Mail“; Kontotypen: **Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten**.
3. Plattform **Mobile und Desktopanwendungen**, Umleitungs-URI `http://127.0.0.1/oauth/callback`
   (bei Loopback-Adressen ignoriert Microsoft den Port).
4. **API-Berechtigungen** (delegiert): `offline_access`, `openid`, `email`, unter
   „Office 365 Exchange Online“ `IMAP.AccessAsUser.All` und `SMTP.Send` sowie **ab 2.1** unter
   „Microsoft Graph“ `Calendars.ReadWrite` und `Contacts.ReadWrite` (Kalender & Kontakte).
   Levuvo Mail holt für Mail (Outlook-Ressource) und Kalender/Kontakte (Graph) getrennte
   Zugriffstoken mit demselben Erneuerungstoken.
5. Die **Anwendungs-ID (Client-ID)** in `package.json` eintragen. Ein Client-Secret wird nicht benötigt.

Hinweise für Kund:innen mit Microsoft 365:
- Je nach Mandant muss ein:e Administrator:in der App einmalig zustimmen.
- **IMAP und „Authentifiziertes SMTP“** müssen für das Postfach aktiviert sein (Microsoft 365 Admin Center → Benutzer → E-Mail → E-Mail-Apps verwalten). Ohne SMTP AUTH funktioniert der Empfang, aber nicht der Versand.

## Google / Gmail

1. <https://console.cloud.google.com> → Projekt anlegen → **APIs & Dienste** → **OAuth-Zustimmungsbildschirm** (Nutzertyp „Extern“), App-Name, Support-Adresse, Datenschutzerklärung (Link auf den Datenschutzhinweis).
2. Bereiche: `openid`, `email`, `https://mail.google.com/` sowie **ab 2.1**
   `https://www.googleapis.com/auth/calendar` und `https://www.googleapis.com/auth/contacts`.
   Unter **APIs & Dienste → Bibliothek** die **Google Calendar API** und die **People API** aktivieren.
3. **Anmeldedaten** → **OAuth-Client-ID** → Anwendungstyp **Desktop-App**. Client-ID und Client-Secret eintragen.

Wichtig – bitte vor der Veröffentlichung einplanen:
- `https://mail.google.com/` ist ein **eingeschränkter Bereich**. Solange die App im Status „Test“ ist,
  können sich nur bis zu 100 eingetragene Testnutzer anmelden, und Google lässt deren Anmeldung
  **nach 7 Tagen ablaufen** (Levuvo Mail fordert dann zur erneuten Anmeldung auf).
- Für die Freigabe an alle Nutzer verlangt Google eine **Verifizierung** und eine jährliche
  **Sicherheitsbewertung (CASA)** durch einen von Google anerkannten Prüfer (kostenpflichtig).
- Bis dahin funktionieren Gmail-Konten zuverlässig mit **App-Passwort** (Google-Konto →
  Sicherheit → Bestätigung in zwei Schritten → App-Passwörter) über die normale Einrichtung.

## Prüfen

1. `npm run desktop:dev` → Einstellungen → Konten: Die Schaltflächen „Mit Microsoft anmelden“ /
   „Mit Google anmelden“ erscheinen nur, wenn eine Client-ID hinterlegt ist.
2. Anmeldung im Browser abschließen; die App zeigt „Konto verbunden“, das Konto erscheint mit dem
   Hinweis „OAuth“. Empfang (IDLE), Versand und Entwürfe testen.
3. Automatisiert: `apps/server/test/integration/full.test.mjs` prüft den kompletten Ablauf gegen einen
   lokalen OAuth-Testanbieter (`LEVUVO_IT_OAUTH_URL`).

## Kalender & Kontakte (ab 2.1)

- Neue Konten erteilen die Kalender- und Kontaktberechtigung gleich bei der Anmeldung.
- Konten aus 2.0 zeigen in Kalender und Kontakten den Hinweis **„Freigeben“**. Ein Klick öffnet die
  Anmeldeseite des Anbieters für genau dieses Postfach; danach wird nur das Erneuerungstoken ersetzt
  (Anmeldung mit einem anderen Postfach wird abgelehnt).
- Fehlt die Freigabe oder ist eine API im Google-Projekt nicht aktiviert, bleiben E-Mail-Empfang und
  -Versand unberührt; nur Kalender/Kontakte des Kontos zeigen den Hinweis.
- Automatisiert geprüft mit Testservern für Graph (Integrationstest) und Google (Unit-Test mit
  nachgebildeten Antworten). Ein Test gegen echte Microsoft-/Google-Konten ist nach dem Eintragen
  der Client-IDs Teil der Abnahme (`RELEASE-CHECKLIST.md`).
