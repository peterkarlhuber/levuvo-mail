# AI assistant

The **Levuvo Mail Assistant** supports you in reading and answering email. It summarizes long messages, suggests replies, finds events and tasks in emails and answers questions about your mailbox.

The assistant is **switched off by default**. It does nothing without you: nothing is sent, saved, moved or deleted unless you confirm it. Everything the AI creates is labelled **AI-generated**.

## What is a language model?

A language model is the program that understands and writes text. There are two kinds:

- **Local model:** runs directly on your computer. No content leaves the device, and everything works without internet too. It needs some memory and disk space.
- **Cloud model** (Anthropic or OpenAI): runs on these providers' servers, often outside the EU. The content needed is sent there. This only happens with your explicit consent.

For local models, Levuvo Mail brings its own, separate program (Ollama). It runs only for Levuvo Mail and can only be reached from this computer. An Ollama you may have installed yourself stays separate.

## Switch on the assistant

![AI settings with model choice and download](settings-ai.png)

1. Open **Settings → AI & agents**.
2. Switch on **AI features**.
3. Leave **Model provider** set to **Local (Ollama)**.
4. Under **Language model**, choose a model from the list. Levuvo Mail suggests the size that fits your computer.
5. The download starts with a progress bar. Depending on your internet it takes a few minutes. **Cancel** pauses it; later you continue with **Resume**.
6. As soon as "… is downloaded and verified" appears, you can start. **Ready** next to **Local AI** only means that the program for local models is running.

For **search by meaning**, Levuvo Mail also downloads a small search model. BGE-M3 is preset; it gave the best results in our tests, especially on German email. With it, the search also finds "delivery" when the email says "shipment".

After the download each model is compared with a fixed checksum, a kind of digital fingerprint of the file. That makes sure exactly the right model is on your computer. Under **Downloaded models**, **Delete** frees the disk space again.

### Which model fits?

{{models}}

Small runs from 8 GB of memory (RAM), Standard from 16 GB, Large from 32 GB. Levuvo Mail shows how much your computer has under **Local AI**. Larger models answer better but more slowly. Models marked **EU** come from Mistral AI in France. With a local model the origin doesn't matter for your data, because it never leaves your computer.

## What the assistant can do

### In a message

The assistant's buttons appear above the text of an open email:

![The assistant in the reading pane](reader-assist.png)

- **Summarize:** who wants what by when, deadlines, amounts and open questions.
- **Translate** into your language.
- **Events, tasks, contacts:** finds them in the email. **Apply** saves them.
- **Check authenticity:** looks for pressure, payment requests, changed bank details and forged senders.

### While writing

In the editor, the **Assistant** button opens these helpers:

- **Suggest a reply**, also from a few keywords of yours.
- **Bullet points to email** turns notes into a complete text.
- **Rewrite:** **Shorter**, **More polite**, **More formal**, **More casual**, **Fix spelling**, **In English** or **In German**. **Undo** takes you back to the original.

Before sending, the assistant checks for forgotten attachments, a harsh tone, wrong recipients and sensitive data. You decide whether to send anyway.

Under **Writing style** you set how the assistant writes for you: tone, formal or informal address, sign-off and your own instructions.

### The assistant window

Click the sparkle icon ✦ on the left or press `Ctrl` + `J`.

![The assistant window](assistant.png)

- **Question:** "When is the delivery from Müller arriving?" The answer names the emails it comes from. One click opens them.
- **Task:** "Find a meeting time with Anna next week." The assistant looks for free times and prepares a draft. Nothing is sent.
- **Routines:** ready-made flows such as a daily briefing, open replies or tidying up newsletters.
- **Approvals:** everything the assistant or an agent prepared that waits for your **Approve** or **Reject**.
- **Change the width:** drag the handle on the left edge of the window to the left to make it wider, to the right to make it narrower. Part of the app always stays visible. With the keyboard, press `Tab` to reach the handle, then use `←` and `→`, with `Shift` for bigger steps. `Home` picks the narrowest, `End` the widest width. A double click resets the width. Levuvo Mail remembers your width. On a phone the assistant fills the whole screen.

## Connect external agents

Advanced users can connect AI programs such as Claude Desktop to Levuvo Mail. For this, Levuvo Mail provides an interface called the MCP server. It can only be reached from this computer. Under **Settings → AI & agents → Agent interface (MCP)** you switch it on and use **New agent** to create an access with fixed rights: read only, create drafts, organize, or everything. Sending, events with attendees and deleting wait for your approval. Only if you tick **send without approval** at the level "Everything incl. sending" does the agent send directly. Passwords, keys and accounts are never reachable for agents.

## Privacy and AI rules

- **Local is the default.** With a local model every piece of content stays on your computer.
- **Cloud only with consent.** Before you use a cloud model, Levuvo Mail shows exactly which content is sent. You can take back your consent at any time with **Withdraw consent**.
- **Lock accounts.** Under **No cloud AI for these accounts** you exclude single mailboxes, such as your work one, from cloud AI entirely.
- **Other people's data.** Emails also contain names and details of your contacts. Use cloud AI for work email only if your organization allows it.
- **Labelling and control.** AI results are always labelled. AI can be wrong: check summaries and suggestions, especially amounts, deadlines and names. You make the final decision; the European AI regulation (EU AI Act) asks for exactly that.
- **AI log.** The **AI log** shows what AI and agents did, without email content, for 30 days and only on this device.
- **Delete everything.** **Delete all AI data** removes settings, consents, keys, the log and agents. Your emails stay unchanged.
