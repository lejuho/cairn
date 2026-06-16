# Step 001 — Today Review Queue: approach check (needs_review surface + inline reply)

Cycle: 5
Pass: 2
Files Changed: (none yet — approach check before implementation)
Planned: shared/src/today.ts, server/src/repositories/events.ts, server/src/services/today.ts, server/src/routes/today.ts, web/src/Today.tsx

## Advisor Verdict
PASS

## Advisor Feedback
1. LEFT JOIN + isNull(annotations.id): correct in Drizzle v0.38, but note existing repo convention is full-scan + JS-filter (findPlannedAndConfirmedByDate). Prefer the join for needs_review since it avoids loading every annotation; keep Drizzle, not raw SQL, for consistency with createEvent/updateEventStatus.
2. State: keep "quiet" = no cards AND no nextEvent. A needs_review-only surface has cards.length>0, so it correctly becomes "live". No redefinition needed — review items demand attention.
3. Use Record<number,ReplyState> — Map's stable reference defeats useState change-detection on mutation. Replace immutably via spread.

## Sonnet Response
- 적용 (판단1): Drizzle leftJoin + isNull(annotations.id) 유지. raw SQL로 가지 않음 — createEvent/updateEventStatus와 일관성. annotation 전체 로드를 피하는 join 방식이 full-scan보다 적합.
- 적용 (판단2): state 계산 변경 없음. quiet = no cards AND nextEvent===null 유지. needs_review 카드는 cards.length>0이므로 자연히 "live"가 됨 — review 항목은 attention 요구이므로 의도 정합.
- 적용 (판단3): Frontend는 Record<number, ReplyState> + useState, immutable spread 갱신 채택. Map 폐기 (참조 동일성이 change-detection을 무력화).
- 무시: 없음.
