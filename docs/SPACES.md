# Shared spaces

A space („Raum“) collects everything about one topic, project or customer: notes that several
people edit at the same time (with checklists), pinned mails with internal comments, tasks and
events with assignees, files with versions, a chat, and an activity list. Anyone can create any number of
spaces and invite people by email address. There is **no Levuvo server**: every member keeps a
complete encrypted copy, and changes travel as end-to-end encrypted mails between the members'
existing mailboxes. This works across providers (for example Hetzner and Microsoft 365).

## Roles

| Role | Can |
|---|---|
| Owner | everything, including inviting, removing members, changing roles, handing over, dissolving, the space's assistant settings |
| Editor | read and change content (notes, mails, comments, chat, tasks, events, files) |
| Reader | read only (also the chat: readers follow along but do not write) |

## How it works

- **Identity:** each installation has an Ed25519 signing key and an X25519 key, stored in the OS
  keychain (`local` / `spaces-identity`). A member's ID is derived from both public keys; the
  *safety code* (6 × 4 digits) can be compared by phone to rule out a man in the middle.
- **Operations:** every change is a signed operation `{author, seq, lc, type, data}`. Sorting all
  operations by Lamport clock, author and sequence and folding them gives the same state on every
  device, whatever order mails arrive in. Notes are Yjs documents (CRDT), so concurrent edits merge
  without conflicts; other fields are last-writer-wins.
- **Permissions** are checked by every member while folding: operations from non-members, from
  readers or after a member was removed are ignored everywhere.
- **Encryption:** content is sealed with the space key (AES-256-GCM, bound to space and key epoch).
  Keys reach members wrapped for their X25519 key (ephemeral ECDH, HKDF-SHA256, AES-256-GCM).
  Every envelope is signed by its sender.
- **Removing a member** records the removal and replaces the space key („Schlüsselrotation“). The
  removed person keeps what they already had but cannot read anything added afterwards.
- **Invitation:** the owner's app sends an invitation mail with a one-time token (valid 14 days).
  The invitee chooses „Beitreten“; their app sends a join request encrypted to the owner, the
  owner's app checks the token and the address, adds the member and sends the key and a fresh
  checkpoint (never the history, so nothing deleted before they joined reaches them).
- **Transport:** sync mails carry the header `X-Levuvo-Space`, a short explanatory text and one
  attachment with the encrypted envelope. They are not saved to „Sent“. On arrival (also from the
  junk folder) Levuvo processes them and moves them into the folder „Levuvo Spaces“, which other
  devices of the same person read as well. Transport mails are deleted there after 30 days; the
  content lives in each member's local copy. Lost mails are recovered automatically: every message
  carries a version vector, and members ask each other for what they lack (at most one open
  request per member, and the same request not again within an hour). In the inbox and junk folder
  only mails newer than the last one looked at are searched; a mail with the header that is no
  usable sync mail is downloaded once and then left alone, one whose content could not be saved is
  tried again with growing pauses. Mails larger than 42 MB are never downloaded.
- **Compatibility:** the header carries the format version (`X-Levuvo-Space: v1; sync`) and so does
  every envelope (`v`) and operation (`v`). A version only processes formats up to its own. Sync
  mails in a newer format are moved out of the inbox but kept in „Levuvo Spaces“ (not deleted after
  30 days) and read again after an update; the spaces view shows that an update is needed.
  Correctly signed operations of a newer format, an unknown type or with data this version
  considers invalid are stored unchanged and passed on to others, but never applied, so version
  vectors stay in step between members on different versions.
- **Checkpoints and deleting:** the owner's app regularly folds the log into a signed checkpoint:
  the state up to a version vector, without the content of deleted things (deleted notes, tasks,
  events and files become empty tombstones, removed mails and deleted comments go, comments on
  them go, activity entries about them lose their titles), plus the notes as Yjs updates. It
  happens after every deletion (at most every 30 seconds), when 500 operations have piled up, and
  whenever someone joins. Members check the header against their own operations (same SHA-256
  digest of the state) and then drop the covered operations and the file parts of deleted files;
  a checkpoint that does not match is not taken over and the full log stays. New members and
  members who fell behind receive the checkpoint itself (in parts of 4 MB) instead of the history;
  they rely on the owner's signature and the digest. Only the current owner makes checkpoints.
- **Fewer mails:** changes made within 20 seconds travel together, one mail per member.
- **Files** are encrypted with a fresh key per version and sent in parts of 5 MB, so mail size
  limits (usually 20–25 MB) are no problem. Files up to 25 MB are sent to everyone right away;
  larger ones are fetched from the uploader when someone opens them. Maximum 250 MB per file.

## Chat

Every space has a chat for quick exchanges between its members. Messages are ordinary space
operations (`chat.post`, `chat.edit`, `chat.delete`), so they are signed, end-to-end encrypted,
permission-checked and delivered exactly like other content, and they work across providers.

- **Speed:** chat operations skip the 20-second batch pause and are sent right away (one mail per
  member; changes that were waiting for the same member travel along). On the receiving side the
  IMAP IDLE connection Levuvo keeps for each inbox anyway reports the new mail; when it looks like
  a sync mail (its subject, or a new message that another device already moved away) the spaces
  receive for that account runs at once. Messages therefore usually arrive within 1 to 5 seconds.
  Normal mail never causes an extra IMAP login.
- **Fallback:** without a healthy IDLE connection (server without IDLE, connection lost) accounts
  with spaces are polled every 30 seconds; with IDLE a safety poll runs every 2 minutes (junk
  folder, missed pushes). Every 5 minutes all accounts are checked for new invitations.
- **Roles:** owners and editors write; readers read. Only the author edits a message; the author
  or the owner deletes it.
- **Deleting** a message removes it for everyone: it triggers a checkpoint, after which the text is
  gone from every member's copy and is never sent to people who join later. Replies show
  „Nachricht gelöscht“.
- **Unread** is kept per device in the local copy and is never sent: there are no read receipts
  and no typing indicators (both would need real-time presence and would reveal working habits).
  The rail and the list of spaces show the number of unread messages.
- **Not in the activity list:** chat messages do not appear there, so the list stays readable.
- **Assistant:** `read_room_chat` reads the chat (framed as untrusted data), `search_rooms` also
  searches it, and `room_chat_post` writes a message after the user's approval. Such messages
  carry `ai: true` and are shown to every member as „KI-erstellt“ (EU AI Act Art. 50).
- **Compatibility:** members on versions without chat keep chat operations unchanged and pass them
  on but do not show them. Spaces in which nobody has chatted fold (and digest) exactly as before.
- **Later: a relay.** The service only hands envelopes to `transport.send` (with an `urgent` hint
  for chat) and takes them back through `receiveEnvelope`; what wakes the receive (IDLE, polling)
  is decided in `routes-spaces.mjs`. An optional, self-hosted relay for instant delivery would be
  one more sender and one more wake-up source; the envelopes stay end-to-end encrypted and signed,
  so the relay would see no content.

## Local storage

```
<data folder>/spaces/<space id>.lvs     state, operations, keys, outbox (AES-256-GCM)
<data folder>/spaces/index.lvs          received invitations, IMAP cursors (AES-256-GCM)
<data folder>/spaces/blobs/<blob>.<n>   file parts, encrypted with the per-file key
```

The local key (`local` / `spaces-key`) is in the OS keychain. Without the keychain spaces stay
locked; existing files are never overwritten with a new key.

## Assistant and agents

The Levuvo Mail Assistant and external agents (MCP) see only spaces in which the user is an active
member and for which the owner has not switched the assistant off. Reading (`list_rooms`,
`read_room`, `room_changes`, `search_rooms`, `read_room_file`, `read_room_chat`) is immediate; content from other
members is framed as untrusted data. Every change (`room_create`, `room_create_note`,
`room_append_note`, `room_add_task`, `room_update_task`, `room_add_event`, `room_comment`,
`room_chat_post`, `room_add_mail`) waits for the user's approval because other members see it. Inviting, removing
members and changing roles (`room_invite`, `room_remove_member`, `room_set_role`) additionally need
the highest agent level. Dissolving a space, deleting the local copy, keys and the space's
assistant settings are not available to the assistant at all. Cloud models and external agents only
see a space if its owner allowed it (`cloudAllowed`, default off); the built-in assistant with a
local model always may.

## Limits

- Changes arrive as fast as mail: chat messages usually within seconds (IDLE), other changes
  after the 20-second batch pause; without IDLE within about 30 seconds.
- Member list, sender, recipients, time and size of sync mails are visible to the mail providers
  involved; the space name is readable in the invitation mail.
- A removed member keeps their copy of what existed before the removal.
