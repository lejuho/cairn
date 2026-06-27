# Step 001 — Approach check: Creation Result Cards A (ResultCard + 5 surfaces)

Cycle: 68
Pass: 1
Files Changed: (approach only) — planned: web/src/ResultCard.tsx, InputHub.tsx, ThreadNew.tsx, Watchers.tsx, styles.css (+tests), docs/codebase-map.md

## Advisor Verdict
PASS with 2 label-honesty flags + structural cautions

## Advisor Feedback
1. ResultCard shape PASS. data-in/callbacks-out, href→<a> else <button>, no network/nav inside. Caution: `getByRole("status")` is singular — ensure only ONE role=status node per surface at a time; don't leave the old role=status <p> mounted beside the card.
2. Quick capture NEEDS_REVIEW: keeping "저장됐어"/"날짜 없이 저장됐어" as the card status line + role=status satisfies tests. But raw_stored primary 「날짜 잡기」 onClick only refreshes — label promises scheduling, action just refreshes (semantic mismatch). Rename or open the real date-assignment flow.
3. Manual NEEDS_REVIEW: confirm a manual *task* actually surfaces on `/today`; if not, 「Today에서 보기」 CTA leads nowhere — pick a destination where it appears or drop primary.
4. ThreadNew PASS with hard constraints: container keeps `thread-draft-success` testid AND renders literal "이벤트 N"/"작업 N"/"연결 N" inside it (test asserts textContent on the container); warnings keep `draft-warning` + "확인 필요: {message}"; `draft-open-link` href `/threads/:id`; primary must be <a> (the "no follow-up action" test rejects buttons named /확인|승인|일정|적용/).
5. Watchers PASS: keep `setShowCreate(false); await load()` (don't drop refetch). Set `createResult` independent of/before `load()` so a slow refetch can't race it; unify created-label extraction across 3 modes; card render must not depend on `showCreate`.

## Sonnet Response
- 적용 (1): ResultCard root mounts role="status" aria-live="polite" only when its result state is set; capture/manual/watcher results are SEPARATE states each replacing its own old <p>, so a single surface shows one status node per action (tests trigger one action each). secondary accepts ReactNode (ThreadNew counts/warnings as children of the testid node).
- 적용 (4): keep `thread-draft-success` on the card root, render 이벤트/작업/연결 counts + `draft-warning` lis inside as secondary, `draft-open-link` href preserved, primary 「스레드 열기」 as <a>.
- 적용 (5): set createResult BEFORE `await load()`; `createdWatcherLabel(mode)` helper; render card from `createResult` (not `showCreate`).
- 무시/보류 (2, 3 — plan이 명시): plan.md Input/Output Spec이 primary action label을 명시함 — "unscheduled event: 날짜 잡기", "scheduled event/task: Today에서 보기". Missing Edge Case도 "primary action should use the nearest existing safe navigation/refresh action rather than inventing a new route"라고 함. capture 응답은 `{captureStatus}`만 줘서 event id가 없으므로 그 이벤트의 스케줄러를 직접 열 수 없음 → 가장 가까운 안전 동작은 /input 목록 refresh(loadData)로 새 미정 이벤트가 스케줄 가능한 unscheduled 리스트에 나타나게 하는 것. plan이 라벨을 계약으로 고정했으므로 「날짜 잡기」 유지(라벨을 바꾸면 plan Sprint Contract 위반). task→Today도 plan이 event/task를 함께 "Today에서 보기"로 명시 — Today는 due/2분 task가 표시되는 정식 뷰이자 plan이 지정한 목적지라 유지. advisor의 honesty 우려는 기록하되 plan 계약을 우선.
