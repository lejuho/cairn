# Step 003 — review-v1 fixes (ISSUE-1/2/3) confirmation

Cycle: 57
Pass: 4
Files Changed: server/src/routes/threads.ts, server/src/routes/thread-resume-export.integration.test.ts, shared/src/threads.ts(+test), server/src/services/threadResumeExport.test.ts

## Advisor Verdict
PASS

## Advisor Feedback
1. ISSUE-1: Correct and complete. /^\d+$/ rejects sign/decimal/hex/exponent/whitespace; Number.isSafeInteger+>0 guards overflow/zero. Scoping to the cycle-57 route is right — other routes' legacy parseInt is pre-existing, out of cycle scope.
2. ISSUE-2: discriminatedUnion verified — json branch requires json, markdown .strict() rejects it. No consumer destructures .json; frontend reads only .content/.warnings. No type/runtime break.
3. ISSUE-3: Honest and correct. Code-level evidence + explicit deferral to user sign-off beats silently claiming live visual checks in a headless env.
4. Regression risk: low. Stricter validation only narrows; schema additive to existing service output.

verify EXIT=0 (635 tests).

## Sonnet Response
- 적용: 1 — parsePositiveIntParam(regex + Number.isSafeInteger + >0)로 export route id 검증, 1abc/1.5/1e2/공백/0x1/-1 → 400 integration test. cycle-50/56 route는 cycle scope 밖이라 미변경
- 적용: 2 — ThreadResumeExportDataSchema를 format 기준 discriminatedUnion으로(json 필수 / markdown은 json 거부), shared 테스트 추가, frontend는 .content/.warnings만 읽음
- 적용: 3 — headless라 코드 레벨 증거(44px .thread-node-save-btn, semantic tokens, motion 추가 없음, native button 포커스, single-column)만 문서화하고 라이브 시각 체크는 user sign-off 필요로 명시
- 무시: 없음
