# Reason queue validation limits (2026-10-30)

Symptom: host systemd access is denied; remote HTTP tests fail with `listen EPERM`
on 127.0.0.1. A separate nested-Node crash probe timed out twice before its child
printed the cache-lock marker (second probe bounded by `timeout 12s`).

Impact: no deployment/live serve-duplicate verification; forced-crash lock
verification inconclusive. The 37 in-process/temp-file tests pass, including
concurrent relay instances and retry after persistence failure.

Evidence: systemctl user/system both report operation not permitted. The HTTP
suite reports a 10s before-hook timeout plus socket EPERM. First crash probe was
cancelled with Ctrl-C; second exited 124 with only parent `spawn 22` output.

Root cause: socket/systemd failures are confirmed environment restrictions.
Nested child startup/marker failure is unlocalized; do not label it a product
locking defect or claim the crash recovery experiment succeeded.

Resolution: do not repeat identical blocked probes. Build/typecheck/lint and
socket-free tests establish only their narrower guarantees. Ask the clean-context
advisor to inspect the nested-process probe boundary. Run host-level restart,
four-address read/read/ack, serve exclusion, and forced-crash validation outside
this sandbox before declaring rollout complete.

Prevention: bound standalone process probes with a timeout and instrument child
startup before the target code. Do not infer runtime deployment from build success.

Follow-up: the full MCP suite again confirms loopback EPERM. Clean-context advisor
serve_advisor inspected this boundary and recommends unchanged HTTP tests on a
socket-capable host/CI, not mocked replacement or conditional skipping. The
socket-free suite now has 39 passing tests. No restart was attempted in this
follow-up. Installed CLI help offers no external serve exclusion/claim API;
local replay suppression must not be presented as that integration.
