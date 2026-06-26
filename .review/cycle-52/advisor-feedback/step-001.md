# Step 001 — Thread Unknown Blocking A (FR-THR-04) approach

Cycle: 52
Pass: 2
Files Changed: (planned) shared/threads.ts, server/src/services/thread-unknown-blockers.ts, server route getThreadDetail, web Thread.tsx

## Advisor Verdict
PASS

## Advisor Feedback
Step-by-step:
1. Direction: correct. requires->prereq=to, blocks->prereq=from matches cycle-48; upstream-missing-blocks-downstream holds.
2. Map by (kind,id) from loaded arrays: sound, pure, no re-query. Unresolved endpoint -> skip safely. Good.
3. Gate (event.start!=null OR task.due!=null; end-only=not target): correct, only reverse-anchor fields count.
4. One blocker per missing field, id link:<linkId>:<field>, sort (linkId,fieldOrder): stable, deterministic.
5. firmness/source surfaced, blocker_soft_link when !hard, UI evidence-only never confirmed: safe.
6. Confirm: no Date.now/random/db/LLM; ThreadDetailSchema.unknownBlockers required; strict rejects score/apply.

Proceed.

## Sonnet Response
- 적용: 모든 판단 지점 1-5 승인됨. 계획대로 진행.
- 적용: point 6 체크리스트 준수 — service에 Date.now/random/db/LLM 없음, ThreadDetailSchema.unknownBlockers required, strict가 score/apply/recommendation 거부.
- 무시: 없음.
