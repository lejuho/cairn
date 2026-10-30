# Clean-context serve-boundary advisor
Reviewer: serve_advisor (separate agent; no executor history).

- Installed reason serve exposes worker management only; reason-network listen exposes as/wait. No inspected supported exclusion/claim/ack interface can coordinate an external serve consumer.
- Durable per-session message-ID deduplication, ack records, and notifier election implement Cairn-local replay suppression only. Stronger exclusion needs upstream claims/routing or explicit exclusive-consumer deployment.
- Preserve remote.test.ts HTTP/OAuth tests. Run unchanged on a socket-capable host/CI. Socket-free tests are narrower evidence, not a substitute.
- No live mailbox consumed, service started, or files mutated by advisor.

Executor response: accepted. Documented requirement 4 and full HTTP verification as outstanding; no unsupported runtime changes or testing bypass.

Final code recheck: no additional blocking regression found. Ack removal and
record persistence are atomic under the shared flock; acceptance follows a
successful write; concurrent watchers notify only accepted messages. Added tests
cover pending/ack replay, restart, missing IDs, session isolation and concurrency.
Notification persistence-to-delivery crash gap remains documented; no durable
notification guarantee is claimed.
