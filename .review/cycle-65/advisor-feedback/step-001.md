# Step 001 — Approach check: Slot Evidence Details A (expand state, secondary lines, a11y, layout)

Cycle: 65
Pass: 1
Files Changed: (approach only) — planned: web/src/Today.tsx, web/src/Today.test.tsx, web/src/styles.css, docs/codebase-map.md

## Advisor Verdict
NEEDS_REVIEW (point 2)

## Advisor Feedback
1. Correct. Per-instance + lens key isolates candidates; lenses unique within one. OK.
2. Risk: `evidence[0] ?? label` keeps empty string ("" is not nullish) → blank primary, hidden content. Use `evidence.find(non-empty) ?? label` for primary, secondary = rest non-empty. Fix before coding.
3. Stable unique aria-label + aria-expanded + type=button: good, keyboard-focusable.
4. Full-width flex-basis:100% row: fine; ensure toggle stays in action row.
5. Confirmed: local setState only, button is sibling not nested in apply, no fetch/nav. Satisfies isolation.

Address #2 primary-selection.

NEEDS_REVIEW

## Sonnet Response
- 적용 (1,3,4,5): SlotReasonList 내부 `useState<Record<string,boolean>>` lens-key 격리 / `<button type=button>` + 안정적 per-lens aria-label(`${label} 추가 근거 보기`) + aria-expanded + 44px / 보조 `<ul>`는 flex-basis:100% 전폭 행 / toggle은 local state만(fetch·schedule·nav 없음) — 그대로 진행.
- 무시 (2): primary를 `evidence.find(non-empty) ?? label`로 바꾸지 않고 기존 `evidence[0] ?? contrib.label` 유지. 이유: (a) plan Sprint Contract가 "The first evidence line remains visible **exactly as today**"를 명시 — primary 선택 로직 변경은 plan 범위/동작 이탈이고 "existing behavior unchanged" 위반. (b) 실제 서버 scorer(slotCandidates.ts)는 evidence[0]에 빈 문자열을 내보내지 않음 — 내용 문자열을 push하거나 evidence:[]를 반환(→ undefined ?? label). 따라서 "evidence[0]===''" blank-primary 케이스는 실데이터에서 발생하지 않음. secondary는 primary와 독립적으로 `evidence.slice(1).filter(s => typeof s==='string' && s.trim()!=='')`로 계산하고, 빈 보조줄은 무시하며 secondary.length>0일 때만 toggle 노출 → blank/empty 보조 리스트 방지. advisor의 robustness 의도(빈 보조줄 무시)는 secondary 필터로 충족.
