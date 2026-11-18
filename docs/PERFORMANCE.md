# Performance with large mailboxes

Levuvo is tested against folders with 100,000 messages. The benchmark uses generated test
messages only, served by an in-process fake IMAP server, so it measures Levuvo's own work
(CPU, memory, data requested from the server) and not network latency.

```sh
npm run bench:mailbox                                  # 100k messages, 100k indexed, 20k vectors
node scripts/bench-large-mailbox.mjs --messages 50000 --json bench.json
```

The script prints the measured values as JSON and exits with 1 when an upper bound is
exceeded. CI runs it on every push and pull request.

## Upper bounds

| Measure | Bound | Measured (Linux x64, Node 22) |
| --- | --- | --- |
| Older folder page, time | 250 ms | ~7 ms |
| Older folder page, UIDs the server sends in SEARCH | 160 | 51 (before: ~50,000) |
| Older folder page, bytes from the server | 64 KB | ~34 KB |
| Folder search, next page: UIDs sent compared to the first page | ≤ 1× | 0.5× (cursor in the middle) |
| Index, first full run (100,000 messages) | 180 s | ~19 s (CPU only; the real limit is the server) |
| Index, run without changes | 2 s, 0 UIDs listed | < 1 ms, 0 UIDs |
| Index search, one page (100,000 messages, worst case: a term in almost every message) | 400 ms | ~25–110 ms; a rare term ~2 ms |
| Vector search, 1024 dimensions, 20,000 vectors | 2 s | ~25 ms (first search loads the vectors: ~170 ms) |
| Heap after the benchmark | 1 GB | small; the vector cache is ~1 KB per vector |

Index file size: ~1.2 KB per message (100k messages ≈ 120 MB), plus ~1 KB per stored vector.

Transfer bounds (UIDs and bytes per page) follow from the algorithm and do not depend on
the machine. Time bounds are generous so slow CI runners pass.

## How it works

- **Folder pages** (`apps/server/src/mailbox.mjs`, `uidsBefore`): the first page is fetched by
  sequence number. Older pages search a UID window just below the cursor. The first window is
  sized from the folder's UID density (`EXISTS / (UIDNEXT − 1)`), and doubles until it holds one
  page plus one UID (which tells whether an older page exists). After 24 rounds the rest of the
  range is taken at once, so the result is always exact.
- **Folder search** (`searchFolder`): later pages add `UID 1:cursor−1` to the IMAP search.
- **Local index** (`apps/server/src/local-index.mjs`): one SQLite database per account, encrypted
  as a whole with SQLCipher (AES-256 + HMAC-SHA512, raw 256-bit key from the system keychain).
  SQLite writes only what changed. Full-text search uses FTS5: word beginnings in all fields
  (`unicode61`, diacritics removed, ß → ss) plus substrings in subject, sender and recipients
  (trigram), so "rechnung" also finds "Stromrechnung" in a subject. Matching row IDs come from
  the FTS indexes alone; few hits are sorted directly, many hits are taken from the date index
  until the page is full. A folder with the same message count and UIDNEXT as after the last
  complete run is not listed again; flags are still refreshed (CONDSTORE when available).
- **Changes for other features**: `entries()` and `removedKeys()` report new and removed entries
  incrementally; `status().generation` changes when the index is rebuilt.
- **Vectors** (AI assistant): `putVectors`, `searchVectors`, `dropVectors` store embeddings in
  the same encrypted file, normalized and quantized to int8 (1 byte per dimension). Search is
  exact (cosine similarity) over an in-memory copy that is rebuilt after a change. Removing a
  message removes its vectors.

## Known limits

- The index holds at most 250,000 messages per account (configurable in code).
- Search in message text matches word beginnings, not arbitrary substrings inside words.
- The unread counter of the inbox uses `SEARCH UNSEEN`, which returns every unread UID.
