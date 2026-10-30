# Reason inbox queue
Branch: feature/reason-inbox-ack
Skills: backend-fastify

## Summary
Extend existing MCP Reason relay to cursor, muse, dots, claude-app with explicit per-message ack.
## 입력/출력 명세
Read rn:inbox:<session> repeatedly returns cachedMessages; rn:ack:<session>:<id> removes only that ID. Owner-qualified names are accepted. receivedAt is local receipt time.
## Key Changes
- Durable pending JSON queue, cross-process serialization, no pending eviction.
- Watch four sessions regardless of Slack config; retain consumed messages on all bridge paths.
- MCP ack, docs, regression tests.
- Persist acknowledged IDs and notify only newly inserted messages to suppress local replay across restarts/concurrent watchers; external serve exclusion requires an upstream interface.
## Sprint Contract
- MCP test, lint, typecheck, build all pass; no schema migrations.
- Real temporary-file tests: repeated reads, scoped ack, restart persistence, >50 messages and concurrent instances.
- Transport remains consuming Reason listen: examine duplicate boundary and document deployment/transport limitations honestly.
## 누락된 엣지 케이스 후보 3개
- Concurrent MCP processes overwrite cache.
- Missing upstream IDs; same ID across recipient sessions.
- Watcher failure for one recipient starves others.
## 더 단순한 대안 1개
In-process lock alone cannot protect stdio and remote MCP writers.
## Assumptions
Reason listen consumes the daemon inbox; no public upstream ack API exists in installed CLI help.
## Review Guidance
Enumerate reads via rg 'listen|takeUnread|readPending|acknowledge' mcp/src. Temporary-file integration proves retention; CLI mock tests prove routing. Live serve delivery needs separate runtime verification.
