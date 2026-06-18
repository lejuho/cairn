# Step 004 — cycle-16 review-v1 fixes (ISSUE-1/2/3)

Cycle: 16
Pass: 4
Files Changed: web/src/Today.tsx, web/src/Today.test.tsx, web/src/styles.css, server/src/repositories/people.ts, server/src/routes/events.integration.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
All claims verified against the diff. `refresh` has stable `[]` deps so adding it to `handleDetailNote` deps is safe; sequential `await` ordering is correct; button nesting is flat (siblings, not nested interactives); orderBy uses imported `asc`.

PASS

- Reply form (concern 1): SAFE. Title `<button>` is a sibling `<li>` child, not a parent of the `<form>`. No event capture overlap; form submit/Enter unaffected. Reply form interaction intact.
- Slot flow (concern 2): SAFE. Title `<button>` is sibling of `today-slot-btn`; slot candidate buttons remain separate. No nested interactive elements; both clickable independently.
- Note-save race (concern 3): SAFE. Sequential `await fetchEventDetail` → `setEventDetail` → `await refresh()` is ordered, no overlapping fetch. `refresh` deps `[]` is stable, so callback identity is stable; dep addition is correct and lint-clean.
- A11y/nesting: No `<button>`-in-`<button>` or `<button>`-in-`<a>` nesting. `aria-label` present on both title buttons. CSS reset prevents visual button styling. Minor: title text now inside button changes tab-order (now focusable) — acceptable/intended.
- Ordering: `asc(people.name), asc(people.id)` matches `findAllPeople`; tie-break by id is deterministic. Correct.

## Sonnet Response
- 적용: Verdict PASS, no changes required. All 3 regression concerns confirmed SAFE. Tab-order change on title (now focusable) noted as intended.
- 무시: 없음.
