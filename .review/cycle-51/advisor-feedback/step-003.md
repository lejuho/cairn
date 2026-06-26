# Step 003 — Loop-break / clarification: gateway invalid_response → 503 semantics (cycle-51)

Cycle: 51
Pass: 2
Files Changed: server/src/services/threadDraft.ts (UNAVAILABLE_CODES set)

## Advisor Verdict
PASS (clarification accepted)

## Advisor Feedback
The completion-check Advisor flagged the error taxonomy: the route maps gateway codes (including `invalid_response`) → 503, while the parser's `invalid_json`/`invalid_schema`/dangling-link → 502. The check-summary wording had grouped `invalid_response` under 502, which conflated the GATEWAY's own error code with the parser-layer codes. Advisor verified the CODE is correct: `invalid_response` is a gateway/transport-level code (malformed proxy payload), correctly grouped in `UNAVAILABLE_CODES` with unavailable/queue_full/rate_limited/mock_not_allowed → retryable 503, mirroring the existing capture/annotation gateway-code handling. The parser's distinct codes (LLM body unparseable / schema-invalid) → invalid_draft → 502.

Biggest risk noted: treating `invalid_response` as retryable (503) — acceptable only if the gateway emits it for transient/transport faults, which is the existing convention.

## Sonnet Response
- 적용: error taxonomy 확인 — gateway 코드(invalid_response 포함)→503, parser 코드(invalid_json/invalid_schema)+invariant(dangling/dup)→502. 두 계층 분리가 의도대로 정확.
- 명확화 (not 무시): check 요약에서 invalid_response를 502로 묶은 것은 서술상의 혼동이었고 코드는 503으로 올바름. `invalid_response`는 gateway 자체 코드(transport/malformed-proxy)라 retryable 503이 기존 capture/annotation 관례와 일치 → 코드 변경 불필요.
- 무시: 없음.
