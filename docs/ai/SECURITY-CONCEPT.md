# Security concept: Levuvo Mail Assistant

How the AI features and the MCP server of Levuvo Mail are protected. It describes the implementation in
this repository; file names point to the code.

## 1. Components and trust boundaries

```
 Levuvo Mail (Electron)                        this computer only
 ┌───────────────────────────────┐
 │ UI ──► Fastify API (cookie,   │   stdin/stdout JSON-RPC   ┌──────────────────────┐   HTTP 127.0.0.1   ┌────────┐
 │        action headers)        │ ────────────────────────► │ AI sidecar (Python,  │ ─────────────────► │ Ollama │
 │          │                    │                           │ Orkexa, minimal env) │                    └────────┘
 │          ▼                    │                           └──────────┬───────────┘
 │  MCP server 127.0.0.1:7341 ◄──┼── Bearer token ── agent runs ────────┘   HTTPS, only with consent
 │  (levels, approvals, log)     │                                          ──────────► Anthropic / OpenAI
 └───────────────────────────────┘
        ▲ Bearer token
   external agents (Claude Desktop, …) on the same computer
```

Untrusted inputs: every email, calendar entry and contact from third parties, and every answer of a model.

## 2. Measures

### Data minimization and locality

- AI is off by default; each function can be switched off (`ai-service.mjs`, `validateAiSettings`).
- Default provider is Ollama on 127.0.0.1; other hosts are refused on both sides (`validateAiSettings`,
  `engine.py: loopback_url`). Models ending in `:cloud` are refused.
- Cloud providers need a recorded consent per provider with the version of the consent text, and an API
  key in the system keychain (never in files or the log).
- Accounts marked "No cloud AI" are refused for every cloud call (`ensureAllowed`), and are hidden from
  agent runs with a cloud model (`hiddenAccounts`, `mcp-server.mjs`).
- Embeddings always run locally.
- The UI sends message references, not content; the server loads the content itself (`routes-ai.mjs`).

### Isolation of the AI component

- Separate process with a minimal environment (no mail credentials, no session secret, `ai-sidecar.mjs`).
  The bundled interpreter runs in isolated mode (`-I`).
- Line limit 16 MiB, timeouts, idle stop after 15 minutes, crash back-off.
- Supply chain: Python from python-build-standalone via uv (SHA-256 verified), third-party wheels only from
  a hash-locked file (`apps/ai/requirements-lock.txt`, `--require-hashes --only-binary`), Tabrion and Orkexa
  from exact commits, the build tool uv itself hash-locked (`requirements-build.txt`). The runtime is
  smoke-tested and its CPU architecture verified in CI (`scripts/build-ai-runtime.mjs`,
  `scripts/verify-app-arch.mjs`). On macOS it is signed and notarized with the app (hardened runtime,
  library validation on in release builds).

### Prompt injection

- Mail and other third-party content reaches the model only inside an `<untrusted_data>` frame that the
  content cannot close (`frame_untrusted`, `frameUntrusted`). The rules tell the model never to follow
  instructions from there.
- Model output is parsed into fixed schemas (Pydantic); ids and sources are filtered to known values.
- The model cannot act by itself: functions only return suggestions; agent tools that change something
  are limited by permission level and, for sending, invitations and the trash, wait for the user's
  approval (contacts and tasks proposed at level draft too). At level organize, moving, archiving,
  marking, snoozing, events without attendees, contacts and tasks run without approval and are logged. Permanent deletion, accounts, passwords, keys, encryption, AI settings and full exports
  are not available as tools.
- A second allow-list in the sidecar restricts each routine to its tools (`agents.py: before_tool`).
- `python -m levuvo_ai.evals` checks a model against synthetic injection mails before it is recommended.
- The user's own instructions only shape style and can never override the safety rules.

### MCP server

- Listens only on 127.0.0.1; checks the Host header; rejects requests with an `Origin` header (no
  browser can call it, DNS rebinding is blocked).
- One token per agent (`lvm_` + 256 bit), stored only as SHA-256, shown once; compared in constant time.
- Levels read / draft / organize / full; "send without approval" is a separate, explicitly confirmed
  setting per agent at level full.
- Rate limit 120 calls per minute per agent; request size limits.
- Approvals expire after 7 days (removed from the file at the next change or start); after the decision
  the payload is deleted; each approval executes at most once. An approval shows the full content
  (sending account, all recipients, full text, attendees). Removing an agent or lowering its level
  withdraws its pending approvals.
- Accounts marked "No cloud AI" are hidden from external agents (their model is assumed to be a cloud
  model), the same way as from the built-in assistant with a cloud model.
- Tokens of the built-in assistant live only in memory and expire after 20 minutes.
- Other modules can add tools only through the registry, which enforces the same levels, log and
  approvals (`createToolRegistry`).

### Transparency and logging

- Results are labelled "AI-generated" with the model name (Art. 50 AI Act). What an agent creates keeps a
  lasting label: drafts carry the header `X-Levuvo-AI-Generated` (shown in the reader and the composer until
  the user sends; the sent message does not carry it, the user reviewed it), events and contacts get a
  closing line "KI-erstellt / AI-generated (Levuvo Mail, Agent: …)" in their description or note.
- Ollama models served by Ollama's cloud (tags `cloud` or `…-cloud`) are refused as local models in the
  settings, the model download and the model list: their content would leave the device.
- The AI log stores no message content, stays on the device, is pruned after 30 days and to 5,000
  entries, and can be cleared at any time. It is not suitable for and not used for performance monitoring.
- "Delete all AI data" removes settings, consents, keys, log, routines, approvals, agents and vectors.

## 3. Residual risks

- A model can still produce wrong or misleading content; mitigated by labelling and review before use.
- An external agent's own model provider receives what the agent reads; only approved agents should be
  connected, at the lowest sufficient level.
- Malware running as the same user on the same computer can reach 127.0.0.1; it would still need an
  agent token, which is stored only as a hash.
- Cloud providers process data under their own terms; a data processing agreement is required.

## 4. Review

Review this concept with every release that changes the AI component, the MCP tools or the dependency
lock, and at least once a year.
