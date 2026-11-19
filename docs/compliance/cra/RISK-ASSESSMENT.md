# Cybersecurity risk assessment

CRA Art. 13(2)–(4), Annex VII no. 3. Reviewed every release. **Not legal advice.**

## 1. Intended purpose and foreseeable use

- **Intended purpose:** desktop client for email (IMAP/SMTP, Microsoft Graph, Gmail), calendars,
  contacts and tasks (CalDAV/CardDAV, Graph, Google), shared spaces, end-to-end encryption
  (OpenPGP, S/MIME, password-protected messages) and an optional AI assistant, for professionals in
  small and medium organisations on macOS (arm64) and Windows (x64, arm64).
- **Reasonably foreseeable use:** processing confidential and professional-secrecy mail (lawyers,
  tax advisers, health), special categories of personal data in mail, shared computers,
  connection of external AI agents via MCP.
- **Foreseeable misuse:** connecting an agent with the level "everything" and auto-approving;
  sending mailbox content to a cloud model in violation of professional secrecy; using AI
  prioritisation to screen job applications (would be high-risk under the AI Act, see
  [../AI-ACT.md](../AI-ACT.md)); using the AI log to monitor employees.

## 2. Operational environment and assets

| Asset | Where | Protection need |
| --- | --- | --- |
| Credentials, OAuth refresh tokens, private keys, store keys | OS keychain | very high |
| Mail, events, contacts, tasks, spaces | provider servers; local encrypted stores and index | high |
| AI prompts and outputs | memory; cloud provider only with consent | high |
| Integrity of the app and its updates | installer, asar, update feed, signing certificates | very high |
| Availability of mail access | app, providers | medium |

## 3. Threats and measures

| # | Threat | Measures | Residual risk |
| --- | --- | --- | --- |
| T1 | Malicious HTML mail (script, tracking, phishing) | Sandboxed srcdoc iframe with CSP `default-src 'none'; sandbox`, DOMPurify, external images blocked, link confirmation, phishing heuristics (SPF/DKIM/DMARC, lookalike domains) | low |
| T2 | Malicious attachment | Dangerous-type confirmation, preview without execution, PDF in native window | low–medium (user decides) |
| T3 | Compromise of the renderer | sandbox, contextIsolation, no nodeIntegration, permission handler, navigation blocked, Fuses | low |
| T4 | Another local process uses the local API | loopback only, random per-start token, action headers, rate limits | low (same-user malware is out of scope) |
| T5 | Prompt injection via mail content to the AI or an agent | content framed as untrusted, approvals before sending/deleting, tool permission levels, MCP only on loopback with per-agent tokens, cloud block per account | medium (inherent to LLMs) |
| T6 | Data leak to a cloud AI provider | off by default, consent per provider, accounts marked "No cloud AI", background sorting local only, Ollama cloud models blocked | low–medium |
| T7 | Man-in-the-middle on mail/DAV/AI | TLS ≥ 1.2 with certificate validation, HTTPS only for DAV, no opportunistic plaintext | low |
| T8 | Supply-chain attack on dependencies | lockfiles, hashed Python locks, pinned commits, SHA-pinned actions, Ollama checksum, model digests, npm audit, pip-audit, Dependabot, SBOM, licence check | medium (industry-wide) |
| T9 | Manipulated update or stolen signing key | signed updates, protected signing environment, no downgrade, incident plan | medium until certificates and HSM exist |
| T10 | Theft of the device | keychain, encrypted stores and index, encrypted backups; full-disk encryption is the user's responsibility (USER-INFORMATION) | low–medium |
| T11 | Known vulnerabilities in Electron/Chromium/Node | Electron support window check, regular updates | medium (update cadence) |
| T12 | Crash dumps with mail fragments | crash reports off by default and only with consent | low |
| T13 | Denial of service by a hostile server (huge mails, slow responses) | size limits, timeouts, windowing, rate limits | low |

## 4. Annex I applicability

All requirements of Annex I Part I apply. (2)(l) logging is implemented proportionately (AI/agent
log, diagnostics on request); a general security event log was judged not necessary for a local
single-user client because the operating system logs process starts and keychain access.

## 5. Review

| Date | Version | Change | Reviewer |
| --- | --- | --- | --- |
| 2026-11-19 | 2.5.0 | First version | development team |
