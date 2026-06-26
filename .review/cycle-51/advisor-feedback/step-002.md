# Step 002 — Thread Draft A: LLM POST /api/threads/draft + ThreadNew NL panel (FR-THR-02/03)

Cycle: 51
Pass: 2
Files Changed: shared/src/threadDraft.ts (+test,+index), server/src/llm/threadDraftParser.ts (+test), server/src/services/threadDraft.ts, server/src/routes/threadDraft.ts, server/src/app.ts, web/src/ThreadNew.tsx (+test), docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Transaction: db.transaction (better-sqlite3, synchronous). findThreadNodeLinks(tx) reads inside the closure on the same connection before commit. Sees just-inserted rows. Sound.
2. Taxonomy mismatch vs claim: route maps gateway codes (incl. invalid_response)→503; but invalid_json/invalid_schema/dangling→502; DB→400. The claim grouped invalid_response under 502 — it is actually 503 (gateway code). Verify intent, otherwise sound.
3. Forced invariants confirmed: service sets soft/inferred, cairn/1/planned, todo; .strict() schemas reject these fields from LLM. Correct.
4. Offsetless/placeholder dates rejected (datetime({offset:true}), isCalendarDate)→invalid_schema→whole draft 502; warnings response-only. Sound.
5. Route registered only under if(gateway); no touch to today/slot/feasibility/decision/watcher/mirror; no auto-confirm/schedule. Scope clean.

VERDICT: PASS
Biggest risk: error-code routing semantics — invalid_response (gateway-level malformed payload) treated as retryable 503, not 502. Confirm intended; a permanently malformed response would invite client retries.

## Sonnet Response
- 적용: Concerns 1,3,4,5 confirmed PASS against source (db.transaction:71, findThreadNodeLinks(tx):145, UNAVAILABLE_CODES:18, route 503/502/400 mapping:33/36/38). No change needed.
- 명확화 (not 무시): Advisor's concern 2 is a naming conflation in the check summary, not a code defect. `invalid_response` is the GATEWAY's own error code (transport/gateway-malformed), correctly grouped with unavailable/queue_full/rate_limited/mock_not_allowed → 503, mirroring capture/annotation gateway-code handling. The parser's distinct codes `invalid_json`/`invalid_schema` (LLM body unparseable/schema-invalid) → invalid_draft → 502. These are different layers; 502 for parse failures is correct and unaffected. Gateway 503 retryability matches existing precedent, so no change.
