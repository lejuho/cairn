# Step 001 — Approach check: cycle-26 Thread Rollup A

Cycle: 26
Pass: 1
Files Changed: none (approach check)

## Advisor Verdict
PASS (with 5 must-fix points before coding)

## Advisor Feedback
1. **Reuse `computeProgress`, do not re-derive.** Existing `computeProgress` (services/threads.ts:35) excludes cancelled/dropped and counts done. Repo helper must match exact rule — best: have pure service consume rows and call same logic, not separate SQL count.

2. **Direction is `from=parent, to=child` for contains.** Confirmed by `findHardContainsParent` and `findContainsAdjacency`. DFS must follow `fromThread→toThread`. New helper needs `firmness="hard"` filter that existing `findContainsAdjacency` lacks.

3. **Energy from `EventRow.start/end` which are nullable + offset datetime.** Both nullable per shared/src/events.ts:19-20. Compute `Date.parse` per event; skip if either null or NaN; clamp negative to 0. Tasks excluded (no time fields). Keep duration read minimal (id/start/end) but use same exclusion set as progress.

4. **`ThreadDetailSchema.rollup` is a breaking required field.** Every consumer and fixture must populate rollup. `getThreadDetail` (line 68-75) is only producer — single touchpoint.

5. **Children ordering + visited set.** Use BFS or track min depth explicitly — DFS order isn't min-depth, causing non-deterministic "ordered by depth" contract. Visited Set seeded with root id prevents self/cycle inclusion.

Watch: Do not edit `findContainsAdjacency` (used for cycle check) — add new hard-filtered helper. Keep service pure (no `db` inside traversal math). Update `docs/codebase-map.md`.

## Sonnet Response
- 적용 1: computeProgress 재사용 — 서비스에서 EventRow[]/TaskRow[] raw rows 전달해 기존 함수 호출
- 적용 2: 새 findHardContainsAdjacencyWithLinks 헬퍼 추가, firmness=hard 필터 포함
- 적용 3: Date.parse, null/NaN 체크, negative clamp 적용
- 적용 4: ThreadDetailSchema 변경 후 기존 통합 테스트 픽스처 일괄 업데이트
- 적용 5: BFS 방식으로 depth tracking — visited Set 시드에 root 포함
