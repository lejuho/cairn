# Step 001 — Approach check: Manual Transit Detail Capture A (note propagation + UI)

Cycle: 80
Pass: 1
Files Changed: (approach) — planned: shared/src/feasibility.ts(+test), server/src/services/travel-time.ts(+integration test), server/src/routes/feasibility.integration.test.ts, web/src/Today.tsx(+test), web/src/styles.css, docs/*

## Advisor Verdict
PASS

## Advisor Feedback
1. APPROVE. `.optional().nullable()` is back-compat under `.strict` (absent key passes; unknown keys still rejected). Add a fixture-replay test proving old payloads still parse.
2. APPROVE. Set note ONLY in `pinnedEvidence`; assert provider/cache paths emit no `note` key (not just null). Trim-to-null guard correct.
3. APPROVE. Render gate = `source==="pinned_user" && note?.trim()`. Test provider+note-injection renders nothing; empty note renders no node.
4. APPROVE. Keep `prefill?` optional; undefined → blank add flow unchanged. Assert submit payload unchanged when note untouched.
5. APPROVE. No creep. Watch: don't let note influence sort/feasibility.
PASS

## Sonnet Response
- 적용 전부: (1) TransitionTravel에 `note: z.string().max(200).nullable().optional()`; .strict 유지로 back-compat + route-step/fare/provider raw 거부; 기존 payload 그대로 parse되는 테스트 포함. (2) note는 pinnedEvidence에서만 설정(blank/whitespace→null); provider/cache evidence 함수(resolvedEvidence/quiet/unavailable)는 note 키를 아예 안 넣음 → 테스트로 provider evidence가 note 키 미보유임을 검증. (3) TransitionTravelLine 렌더 게이트 = `source==="pinned_user" && note?.trim()`; provider+injected-note → 렌더 없음, 빈 note → 노드 없음. (4) pin controller `open(from,to,prefill?)`, 수정 버튼은 현재 pinned evidence에서 duration/note prefill, 신규(add)는 undefined→blank; submit payload(event ids+duration+note?)는 불변. (5) note는 gap math/sequence energy/ordering/sort에 영향 없음(설명용 컨텍스트만).
- 무시: 없음.
