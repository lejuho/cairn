# Step 002 — Completion check: Thread Links A backend vertical (commit-1)

Cycle: 25
Pass: 2
Files Changed: shared/src/threads.ts, server/src/repositories/threads.ts, server/src/services/thread-links.ts (new), server/src/services/threads.ts, server/src/routes/threads.ts, server/src/routes/threads.integration.test.ts, server/src/services/thread-links.test.ts (new)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
- Concern 1 (CONFIRMED real, blocking): Web `tsc --noEmit` FAILS. `relationCounts` now required breaks `web/src/ThreadIndex.test.tsx:16` (TS2741). Also `Thread.test.tsx` (4 errors) missing `relations` — pre-existing from cycle-24 leak, but build is red regardless. Web tests/build will not pass.
- Concern 2 (alias join — correct): `ft`/`tt` aliases distinct; `ft.name`→fromThreadName via `eq(fromThread, ft.id)`, `tt.name`→toThreadName via `eq(toThread, tt.id)`. Peer split by `r.toThreadId === threadId`→incoming. Logic sound; integration test covers real SQLite.
- Concern 3 (CONFIRMED): Web tests cannot pass while tsc is red.
- Schema change is a hard, non-backward-compatible contract change; server emits it but web mocks weren't updated.
- Fix: add `relationCounts` to web test mocks (and `relations` to Thread.test.tsx) before commit.

VERDICT: NEEDS_REVIEW

## Sonnet Response
- 적용: Concern 1 — `web/src/ThreadIndex.test.tsx` SUMMARY mock에 `relationCounts: { incoming: 0, outgoing: 0 }` 추가. Web tsc TS2741 해소.
- 적용: Concern 1 (Thread.test.tsx) — `mockFetch` 시그니처를 `Omit<ThreadDetail,"relations"> & Partial<Pick<...,"relations">>`로 변경하고 `EMPTY_RELATIONS` 기본값 병합. 4개 call-site 수정 없이 `relations` 필수 누락 4건 해소. (이 `relations`는 cycle-24 detail-schema 변경의 web-test 누수였고, 본 commit이 build red를 만든 schema 변경과 같은 파일군이라 함께 정리.)
- 적용: Concern 3 — web tsc EXIT 0 확인, `npx vitest run` 208/208 pass 확인.
- 확인됨 (Concern 2): alias join은 advisor가 코드 직접 검증, 무수정. integration 317 pass.
- 비고: ThreadIndex.tsx/Thread.tsx 비-test 소비자는 새 필드를 아직 렌더하지 않음 — plan상 UI(관계 추가/삭제, 카운트 표시)는 후속 commit. commit-1은 contract 확립 backend vertical이며 새 필드는 additive라 컴파일 통과.
