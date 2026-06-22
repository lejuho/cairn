# Step 003 — Approach check: cycle-34 review-v1 fixes

Cycle: 34
Pass: 3
Files Changed: (planned) server/src/jobs/watcher-push-scheduler.ts, server/src/jobs/watcher-push-scheduler.test.ts, server/src/index.ts, deploy/env/cairn-server.env.example

## Advisor Verdict
PASS

## Advisor Feedback
1. `msUntilNextLocalTime(hour, minute, now = new Date())` with injected `now` — correct seam, no deeper clock abstraction needed.
2. Overlap test: fake timers + manually-controlled unresolved Promise. Trigger fire(), advance timers, fire() again while running=true, assert sender called once.
3. Config-object injection (no process.env in scheduler) — read env in index.ts, pass typed config. Keeps validation unit-testable.
4. Range guards: validate hour/minute together before scheduling; log once and return null.

## Sonnet Response
- 적용 (1): msUntilNextLocalTime에 now?: Date 주입 파라미터 추가
- 적용 (2): deferred promise + fake timers로 overlap 테스트
- 적용 (3): config 객체 주입 — process.env는 index.ts에서만 읽음
- 적용 (4): hour 0-23, minute 0-59 범위 체크, NaN 체크 포함
