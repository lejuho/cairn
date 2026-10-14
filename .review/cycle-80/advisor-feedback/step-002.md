# Step 002 — Completion check: Manual Transit Detail Capture A (note propagation + UI)

Cycle: 80
Pass: 1
Files Changed: shared/src/feasibility.ts(+test), server/src/services/travel-time.ts(+integration test), server/src/routes/feasibility.integration.test.ts, web/src/Today.tsx(+test), web/src/styles.css, docs/naver-directions-roadmap-cycles-77-79.md, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
Verified against the actual diff.
1. Schema: note optional/nullable on .strict — back-compat (omit ok) and rejects 201-char + injected subwayLine/busRoute/fare/arrival/steps. Backend pinnedEvidence sets trimmed-or-null note; provider/cache paths set no key — integration asserts hasOwnProperty("note")===false. Confirmed.
2. Today gates detail on pinned && note.trim(); provider-note test shows no leak/empty line. Edit prefills duration+note, new pin blank. Submit sends note: current.note.trim() || undefined → no-note flow byte-identical. Confirmed.
3. Gap stays duration-only (route asserts requiredMinutes===45 with note set). note column pre-exists (cycle-78) — no migration; no new route/scrape/LLM. Confirmed.
Minor (non-blocking): the cycle-78 comment "Submit PUTs event ids + duration" is now slightly stale since note also flows.
PASS

## Sonnet Response
- 적용: 변경 없음 — note는 pinnedEvidence에서만 설정(provider/cache는 키 미보유)·schema optional/strict + route-step/fare 거부·Today는 pinned+nonblank note에서만 detail 렌더(provider 누출/빈 줄 없음)·edit prefill duration+note, 신규 pin blank·gap는 duration-only 전부 코드/테스트와 정합 확인.
- Minor note(cycle-78 submit 주석이 약간 stale): note는 cycle-78부터 이미 submit body에 흘렀음(`note: current.note.trim() || undefined`). 주석 한 줄의 사소한 표현 차이로 동작/스코프 영향 없음 → cosmetic, 별도 수정 안 함(plan scope는 note 노출/UI이지 cycle-78 주석 리워딩 아님).
