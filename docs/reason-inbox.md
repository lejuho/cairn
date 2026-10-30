# Reason Network inbox via Cairn MCP

The remote Cairn watcher polls `zedd1324/cursor`, `zedd1324/muse`,
`zedd1324/dots`, and `zedd1324/claude-app` every three seconds plus poll time,
independently of Slack. Only dots messages trigger the existing Slack relay.
Start the remote MCP service to run the persistent watcher; stdio-only reads
return persisted data and do not start a watcher.

Read with `cairn_context_now({"cwd":"rn:inbox:cursor"})` (also supported by
`cairn_inbox`). Owner-qualified `rn:inbox:zedd1324/cursor` works too.
Omitting the session reads dots. Reads never delete or mark messages read.
`rn:mcp:check_inbox:{"as":"cursor"}` also reads the same queue without upstream consumption.

The JSON text result is:

```json
{
  "ok": true,
  "data": {"session": "cursor"},
  "cachedMessages": [{
    "session": "cursor",
    "message_id": "01EXAMPLE",
    "from": "zedd1324/muse",
    "agent": "muse",
    "text": "message body",
    "raw": "original reason-message block",
    "receivedAt": "2026-10-30T09:00:00.000Z",
    "unread": true
  }]
}
```

`receivedAt` is Cairn's UTC receipt time, not the sender's timestamp (the
installed listener output does not supply one). Missing upstream IDs receive
a stable SHA-256 ID of their raw block.

After handling a message, explicitly call
`cairn_context_now({"cwd":"rn:ack:cursor:01EXAMPLE"})`.
It returns `{"ok":true,"data":{"session":"cursor","message_id":"01EXAMPLE","acknowledged":true}}`.
A repeated ack or an ID absent from that session returns `acknowledged:false`.
Ack removes only that ID in that session and retains its ID as a durable
acknowledgement record. Re-ingesting that ID in that session cannot restore it.
Old caches without acknowledgement records remain readable; acknowledgements
made before this change cannot be reconstructed. There is no automatic expiry or
50-message cap. Existing persisted messages marked read by the old implementation
are restored as pending because those reads were not explicit acknowledgements.

`claude-app` is ONE shared mailbox for all Claude app conversations. Any of those
conversations can read the same pending messages. An ack removes a message for
all of them; this is not a per-conversation claim/lease system.

## Persistence and transport boundary

Cache: `/home/pi/cairn-data/reason-inbox-cache.json`, overridable with
`REASON_INBOX_CACHE_PATH`. Writers use a Linux `flock` child and atomic rename;
the `.flock` file must not be removed while processes are running. The lock is
released when the process dies and its child stdin closes. All writers must run
this version: an older process can overwrite acknowledgement records because it
does not preserve that field. Building alone does not upgrade a running writer.
Linux util-linux
`flock`, `sh`, and `cat` are runtime prerequisites (present on this Pi).

MCP inbox reads and acknowledgements never call upstream `listen`. The watcher
uses the installed consuming `reason-network listen --as SESSION --wait 0`.
Ask and unregistered-send bootstrap paths also persist their listener results.
This avoids re-exposing drained messages through Cairn reads.

### Requirement 4: implemented boundary and outstanding serve integration

Cairn deduplicates by `(session, message_id)` under the shared file lock. Pending
IDs and acknowledged IDs both suppress re-ingestion, including after restart.
The atomic cache update returns only newly inserted messages to the watcher, so
concurrent watchers elect a single Slack/webhook notifier. Replayed pending or
acknowledged messages do not create another notification. Missing IDs use a stable
SHA-256 fingerprint of the raw message. This does not identify the same content
sent under a different upstream ID.

**External Reason daemon/serve exclusion remains unimplemented and unverified.**
Cairn does not own the serve consumer. Installed `reason serve --help` exposes
worker lifecycle options, and `reason-network listen --help` exposes only `--as`
and `--wait`; neither exposes routing exclusion, delivery claims, or peek/ack.
An already delivered serve message or independent remote mailbox cannot be
retracted by Cairn's cache. Completing the stronger requirement needs a supported
upstream shared claim/routing API or an explicitly configured exclusive consumer.
A file lock around Cairn's cache cannot provide that coordination. Do not report
requirement 4 as fully complete based on the local replay tests.

Reads are not execution claims: two clients may read and process the same pending
message before either acknowledges it. Ask responses also expose the listener's
raw response; consumers must deduplicate those by ID. Acknowledgement records
have no expiry and grow with traffic; deleting them allows old IDs to reappear.

Notifications are attempted only for newly persisted messages. A crash after
persistence but before notification, or exhausted callback retries, can omit a
notification; the inbox message remains pending. This is not a durable delivery
outbox or an exactly-once side-effect guarantee.

The watcher verifies cache writability before draining and retries a failed
write before listening to that session again. A hard crash between upstream
consumption and persistence can still lose the in-flight batch: the installed
CLI has no peek/ack or atomic transfer API. An upstream transport change is
needed for a strict end-to-end no-loss/exactly-once guarantee. Consumers should
also be idempotent by message ID: explicit ack controls queue retention, not
exclusive execution across multiple clients.

## Validation / rollout (2026-10-30)

MCP socket-free unit/file integration suite: **39/39 passed** (five files),
including concurrent notifier election and acknowledged replay after restart.
MCP `typecheck`, `lint`, and `build`: **passed**. `git diff --check`: **passed**.
The unchanged full MCP test command fails because `remote.test.ts` cannot bind
127.0.0.1 in this sandbox (`listen EPERM`); its four HTTP tests do not run.
The initial full-suite run had 37 passing tests before the two new regressions
were added. Do not count the blocked HTTP tests as passing or the full suite as
green. Re-run `corepack pnpm --filter @cairn/mcp test` on a socket-capable host/CI;
this test command does not require a production service restart.

No service restart was attempted in this follow-up, per user instruction.
Service restart and live serve/queue verification remain user-operated host work. Source/build changes alone do not update an already
running MCP process. After restarting `cairn-mcp-remote`, inspect `rn:events`
for the four sessions and `lastError`, then send a dedicated test message to
each address, read twice, ack, and verify disappearance plus no serve replay.
