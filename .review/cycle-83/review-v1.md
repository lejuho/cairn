# Review v1

## Verdict
BLOCKED

## Findings
- Queue implementation and regression tests completed; deployment is not applied because systemd is inaccessible in the sandbox.
- Requirement 4: no daemon/serve exclusion was implemented or live-verified. The consuming listen boundary is retained, not an end-to-end duplicate guarantee.
- CLI consumption→persist hard-crash window remains; installed CLI exposes no peek/ack API.

## Automatic Checks
- 37 tests in api, server, tools, events, reason-relay: PASS.
- MCP typecheck, lint, build: PASS.
- Full remote HTTP suite: blocked by listen EPERM on 127.0.0.1.
- git diff --check: PASS.
- Additional standalone nested-Node crash probe: inconclusive, timed out before acquiring marker; do not claim crash test passed.

## Scope
Pre-existing uncommitted webhook/remote/server changes preserved. No commit created.

<!-- RESOLVED-BOUNDARY -->

## Follow-up status (2026-10-30)
- Added durable acknowledged-ID records and atomic acceptance results. Watchers notify only newly inserted messages, preventing local replay after restart/ack and duplicate notification by concurrent watchers.
- 39/39 socket-free MCP tests pass; MCP typecheck/lint/build pass. Full-suite HTTP tests remain blocked by loopback `EPERM` (4 not executed); tests were not weakened or skipped in configuration.
- Requirement 4 remains partially unmet: no supported external serve routing/claim API was found. Local replay suppression is not external serve exclusion. See docs/reason-inbox.md.
- No restart, push, or merge. This follow-up does not change the BLOCKED verdict or claim deployment readiness.
