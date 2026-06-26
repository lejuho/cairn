# Step 001 — Approach check: Thread Draft A (cycle-51)

Cycle: 51
Pass: 2
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Date rejection sound: `datetime({offset:true})` + isCalendarDate reject "?"/"TBD"/offsetless → never stores ambiguous/fabricated time. Downside: one bad date fails whole draft (502, no partial salvage). Plan permits rejection. Pair with SYSTEM_PROMPT "explicit null, no guessed dates" so both layers align.
2. Pre-transaction invariant checks (dangling tempId, dup tempId) + single db.transaction rollback-on-throw → all-or-none. Failure inserts nothing.
3. Service forces firmness=soft/source=inferred/event source=cairn+self_imposed=1+status=planned/task=todo; `.strict()` rejects same fields from LLM. AI cannot write hard/authored.
4. Mapping (gateway→503, parse/schema/invariant→502, db→400) + register `if(gateway)` mirrors capture/annotation; no fabricated output on failure.
5. Use only soft/inferred literals in draft code; avoid hard/authored tokens so static scan stays clean. Low risk.

## Sonnet Response
- 적용: 1 — 날짜 schema-level 거부 (datetime offset + isCalendarDate), SYSTEM_PROMPT가 null/no-guess 요구
- 적용: 2 — transaction 전 dangling/dup tempId 검사, db.transaction rollback로 all-or-none
- 적용: 3 — service가 soft/inferred/cairn/planned/todo 강제, strict가 LLM의 해당 필드 거부
- 적용: 4 — gateway→503, parse/schema/invariant→502, db→400; gateway 있을 때만 등록
- 적용: 5 — draft 코드/주석에 hard/authored 토큰 미사용 (soft/inferred만)
