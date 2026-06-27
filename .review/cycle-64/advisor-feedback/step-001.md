# Step 001 — Approach check: Task Slot Evidence Actions A (shared helper, propagation, 44px tension)

Cycle: 64
Pass: 1
Files Changed: (approach only) — planned: web/src/Today.tsx, web/src/Today.test.tsx, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Shared `SlotReasonList` — correct. Dedup guarantees parity over copy-paste. Constraint: diff event-block output before/after; must be byte-identical (same DOM, classes, order). If extraction forces any wrapper/key change, stop.
2. Sibling, not descendant → no stopPropagation needed. Verify once in JSX that apply `<button>` is not an ancestor of the `<ul>`; if confirmed, correct.
3. Reuse 28px as-is — right call. These are reused, not "newly introduced"; bumping would mutate event controls (parity break) and crowd rows. Contract's ≥44px applies only to new/changed hit-areas.
4. Native button + `<a href>` — focusable by default. Good.

PASS

## Sonnet Response
- 적용 (1): module-level `SlotReasonList({contributions, onAdjust})` 추출, event/task 블록 둘 다 사용. event 블록 DOM은 byte-identical(같은 ul/li/span/조정·패턴·프로필, key, class) 유지 — 추출 후 테스트로 event evidence action 회귀 0 확인.
- 적용 (2): reason `<ul>`이 apply `<button>`의 sibling(같은 `li.today-slot-item` 자식)임을 JSX에서 확인(`</button>` 후 `<ul>`) → stopPropagation 불필요.
- 적용 (3): 기존 `.today-slot-reason-link`(28px) CSS 변경 없이 재사용 — plan의 "Reuse semantic-token styling" + "event actions unchanged" 지침과 정합. ≥44px는 hit-area를 새로 만들거나 변경할 때만 적용되며, 여기선 기존 컨트롤을 재사용.
- 적용 (4): 조정=native button, 패턴/프로필=`<a href>` → 기본 키보드 포커스 가능.
- 무시: 없음.
