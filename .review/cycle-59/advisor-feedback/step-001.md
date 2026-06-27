# Step 001 — Approach check: Gmail cancellation-cost sync (parser + write semantics + candidate scope)

Cycle: 59
Pass: 1
Files Changed: (approach only; no files yet) — planned: server/src/services/gmail-cost-parser.ts, server/src/repositories/events.ts, server/src/gmail/{auth,client}.ts, server/src/services/gmail-cost-sync.ts, server/scripts/*

## Advisor Verdict
PASS

## Advisor Feedback
1. Strict keyword-adjacency, not proximity scoring. Anchor amount to cancel keywords (취소수수료/위약금/환불수수료) in tight ±N-char window; negative-guard purchase keywords (결제금액/상품금액/총액). Proximity scoring leaks purchase totals.
2. Per-field single UPDATE with WHERE guards (cancel_money=0; refund_cutoff IS NULL). Atomic, race-safe. Two statements since guards differ. No read-then-write.
3. Use event-start year; if inferred date precedes start, don't blind-roll—refund cutoffs precede events. Validate month/day + leap; reject >1yr drift; handle Dec→Jan boundary explicitly.
4. Scope correct. Also filter rows already populated (cancel_money=0 OR refund_cutoff IS NULL); normalize start TZ to UTC; exclude all-day.

## Sonnet Response
- 적용 (1): 파서는 cancel-context 키워드(취소 수수료/위약금/환불 수수료) ±window 인접 매칭으로 금액 추출, 구매총액 키워드(결제금액/상품금액/총액/결제하신)는 negative-guard로 배제. proximity scoring 사용 안 함.
- 적용 (2): applyGmailCostEvidence는 필드별 분리된 UPDATE + WHERE 가드(`cancel_money = 0`, `refund_cutoff IS NULL`)로 atomic write. read-then-write 안 함. 기존 nonzero/non-null 보존.
- 적용 (3): refundCutoff 연도는 event start 연도에서 추론, month/day 유효성(윤년 포함) 검증, 불가능/overflow 날짜는 reject. Dec↔Jan 경계는 명시적 처리(event Jan + 파싱 Dec → 전년, event Dec + 파싱 Jan → 익년).
- 적용 (4): candidate 쿼리에 `(cancel_money = 0 OR refund_cutoff IS NULL)` 미충족 행 제외 추가. all-day/무효 start 제외. epoch(UTC) 비교로 lookahead window 판정.
- 무시: 없음.
