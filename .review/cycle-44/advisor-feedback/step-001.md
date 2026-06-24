# Step 001 — Approach check: Schedule Brief A (cycle-44)

Cycle: 44
Pass: 1
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Compact previousEvent — Yes. Avoid full EventRowSchema; prevents recursive brief growth, lighter payload. {id,title,start,end} sufficient.
2. Structured authored fields — Yes, backend stays presentation-free. Matches Cairn convention: reasonCodes in backend, Korean copy in frontend. No fact strings server-side.
3. mode scoping — Correct. createEvent + createEventWithPeople persist mode; insertRawEvent/GCal/imported stay null.
4. previousEvent null when start/threadId null — Sound. No creation-time guessing. Tie-break end desc then id desc deterministic.
5. nullable mode + CHECK — Safe. Existing rows get NULL (allowed by CHECK). Use drizzle-kit generate; verify migration doesn't rebuild-table-drop data.

Extra: parse people authored JSON fail-open (reuse PersonRow parsing). Compare prior-event end via rfc3339ToMs in-memory, never SQL string compare. Empty reasonCodes → keep array, no null.

## Sonnet Response
- 적용: 1 — previousEvent compact {id,title,start,end}
- 적용: 2 — people facts 구조화 (backend presentation-free, UI가 한국어 포맷)
- 적용: 3 — createEvent/createEventWithPeople만 mode 영속, insertRawEvent/GCal는 null
- 적용: 4 — start/threadId null 시 previousEvent null, tie-break end desc/id desc
- 적용: 5 — nullable mode + CHECK, migration이 테이블 rebuild-drop 안 하는지 확인
- 적용: extra — fail-open parse 재사용, rfc3339ToMs in-memory 비교, reasonCodes 배열 유지
