# Performance with large mailboxes

Levuvo is tested against folders with 100,000 messages. The benchmark uses generated test
messages only, served by an in-process fake IMAP server, so it measures Levuvo's own work
(CPU, memory, data requested from the server) and not network latency.

```sh
npm run bench:mailbox                                  # 100k messages, 25k indexed
node scripts/bench-large-mailbox.mjs --messages 50000 --json bench.json
```

The script prints the measured values as JSON and exits with 1 when an upper bound is
exceeded. CI runs it on every push and pull request.

## Upper bounds

| Measure | Bound | Measured (Linux x64, Node 22) |
| --- | --- | --- |
| Older folder page, time | 250 ms | ~5 ms |
| Older folder page, UIDs the server sends in SEARCH | 160 | 51 (before: ~50,000) |
| Older folder page, bytes from the server | 64 KB | ~34 KB |
| Folder search, next page: UIDs sent compared to the first page | ≤ 1× | 0.5× (cursor in the middle) |
| Index, first full run (25,000 messages) | 60 s | ~4 s |
| Index, run without changes | 2 s, 0 UIDs listed | ~3 ms, 0 UIDs |
| Index search, one page (25,000 messages) | 400 ms | ~20 ms (first search ~80 ms) |
| Heap after the benchmark | 1 GB | ~70 MB |

Transfer bounds (UIDs and bytes per page) follow from the algorithm and do not depend on
the machine. Time bounds are generous so slow CI runners pass.

## How it works

- **Folder pages** (`apps/server/src/mailbox.mjs`, `uidsBefore`): the first page is fetched by
  sequence number. Older pages search a UID window just below the cursor. The first window is
  sized from the folder's UID density (`EXISTS / (UIDNEXT − 1)`), and doubles until it holds one
  page plus one UID (which tells whether an older page exists). After 24 rounds the rest of the
  range is taken at once, so the result is always exact.
- **Folder search** (`searchFolder`): later pages add `UID 1:cursor−1` to the IMAP search.
- **Local index** (`apps/server/src/local-index.mjs`): a folder with the same message count and
  UIDNEXT as after the last complete run is not listed again; flags are still refreshed
  (CONDSTORE when available). Search walks a date-ordered list that is rebuilt only after a
  change and turns only the requested page into results. `entries()` and `removedKeys()` give
  incremental changes to features built on the index.

## Known limits

- The local index holds at most 25,000 messages per account. It is one encrypted file that is
  rewritten as a whole after a change. A storage engine that writes only what changed
  (encrypted SQLite with FTS5) is the planned next step.
- The unread counter of the inbox uses `SEARCH UNSEEN`, which returns every unread UID.
