# Enabling “Sign in with Microsoft” and “Sign in with Google”

Levuvo Mail contains the complete OAuth 2.0 sign-in (authorization code with PKCE, redirect to
`http://127.0.0.1:<port>/oauth/callback`, IMAP/SMTP via XOAUTH2, refresh token in the keychain).
For the buttons to appear, the build needs a **client ID per provider**. Only Levuvo, as the
publisher, can carry out this registration.

Enter it in `package.json` (it is built into the app):

```json
"levuvo": {
  "oauth": {
    "microsoft": { "clientId": "00000000-0000-0000-0000-000000000000" },
    "google": { "clientId": "….apps.googleusercontent.com", "clientSecret": "GOCSPX-…" }
  }
}
```

For local tests, alternatively as environment variables: `LEVUVO_OAUTH_MICROSOFT_CLIENT_ID`,
`LEVUVO_OAUTH_GOOGLE_CLIENT_ID`, `LEVUVO_OAUTH_GOOGLE_CLIENT_SECRET`.

For desktop apps the client ID and (for Google) the “client secret” are **not secret** – they are
contained in every installed app. Security comes from PKCE and the local redirect.

## Microsoft 365 / Outlook.com (Microsoft Entra ID)

1. <https://entra.microsoft.com> → **App registrations** → **New registration**.
2. Name “Levuvo Mail”; account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Platform **Mobile and desktop applications**, redirect URI `http://127.0.0.1/oauth/callback`
   (Microsoft ignores the port for loopback addresses).
4. **API permissions** (delegated): `offline_access`, `openid`, `email`, under
   “Office 365 Exchange Online” `IMAP.AccessAsUser.All` and `SMTP.Send`, and **from 2.1** under
   “Microsoft Graph” `Calendars.ReadWrite` and `Contacts.ReadWrite` (calendar & contacts).
   Levuvo Mail fetches separate access tokens for mail (Outlook resource) and calendar/contacts (Graph)
   with the same refresh token.
5. Enter the **Application (client) ID** in `package.json`. No client secret is needed.

Notes for customers with Microsoft 365:
- Depending on the tenant, an administrator must consent to the app once.
- **IMAP and “Authenticated SMTP”** must be enabled for the mailbox (Microsoft 365 admin center → Users → Mail → Manage email apps). Without SMTP AUTH receiving works, but sending does not.

## Google / Gmail

1. <https://console.cloud.google.com> → create a project → **APIs & Services** → **OAuth consent screen** (user type “External”), app name, support address, privacy policy (link to the privacy notice).
2. Scopes: `openid`, `email`, `https://mail.google.com/` and **from 2.1**
   `https://www.googleapis.com/auth/calendar` and `https://www.googleapis.com/auth/contacts`.
   Under **APIs & Services → Library**, enable the **Google Calendar API** and the **People API**.
3. **Credentials** → **OAuth client ID** → application type **Desktop app**. Enter the client ID and client secret.

Important – please plan for this before publication:
- `https://mail.google.com/` is a **restricted scope**. As long as the app is in “Testing” status,
  only up to 100 registered test users can sign in, and Google **expires their sign-in after 7 days**
  (Levuvo Mail then asks them to sign in again).
- To release it to all users, Google requires **verification** and an annual
  **security assessment (CASA)** by a Google-approved assessor (paid).
- Until then, Gmail accounts work reliably with an **app password** (Google Account →
  Security → 2-Step Verification → App passwords) via the normal setup.

## Verify

1. `npm run desktop:dev` → Settings → Accounts: the buttons “Sign in with Microsoft” /
   “Sign in with Google” appear only if a client ID is configured.
2. Complete the sign-in in the browser; the app shows “Account connected.” and the account appears with
   the “OAuth” label. Test receiving (IDLE), sending and drafts.
3. Automated: `apps/server/test/integration/full.test.mjs` checks the complete flow against a
   local OAuth test provider (`LEVUVO_IT_OAUTH_URL`).

## Calendar & contacts (from 2.1)

- New accounts grant the calendar and contacts permission right at sign-in.
- Accounts from 2.0 show the notice **“Allow access”** in calendar and contacts. A click opens the
  provider's sign-in page for exactly this mailbox; afterwards only the refresh token is replaced
  (signing in with a different mailbox is rejected).
- If consent is missing or an API is not enabled in the Google project, receiving and sending email
  are unaffected; only the account's calendar/contacts show the notice.
- Tested automatically with test servers for Graph (integration test) and Google (unit test with
  simulated responses). A test against real Microsoft/Google accounts is part of acceptance after
  entering the client IDs (`RELEASE-CHECKLIST.md`).
