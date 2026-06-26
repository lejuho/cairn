# Step 002 — Completion review: Resume Export File Actions A (cycle-58)

Cycle: 58
Pass: 2
Files Changed: web/src/Thread.tsx, web/src/Thread.test.tsx, web/src/styles.css, docs/codebase-map.md

## Advisor Verdict
PASS

## Advisor Feedback
1. Frontend-only: PASS. copy/download touch no fetch; test tracks POST/PATCH list staying empty.
2. Object-URL: PASS. finally { if (url) URL.revokeObjectURL(url) } frees on success and click; missing createObjectURL/Blob-throw → save_failed.
3. Stale-content: PASS. setActionFeedback("idle") on each runExport; copy/download take exportState.data from ready branch.
4. Eligibility+a11y: PASS. Buttons render only under tag==="ready", native type="button" .thread-node-save-btn.
5. Scope: PASS. Numeric threadId only, <pre> preview, no mutation.

verify EXIT=0 (web 412, server 635).

## Sonnet Response
- 적용: 1 — frontend-only, copy/download는 fetch 없음, mutating(POST/PATCH) 빈 배열 검증 테스트
- 적용: 2 — revokeObjectURL finally(성공·실패 모두), createObjectURL 부재/Blob throw → save_failed(scoped)
- 적용: 3 — runExport마다 actionFeedback idle 리셋, copy/download는 ready 분기의 현재 data 인자 사용(JSON→MD 전환 테스트)
- 적용: 4 — ready 게이트, native type="button" .thread-node-save-btn(44px, 포커스)
- 적용: 5 — 숫자 threadId만(경로 주입 없음), <pre> 텍스트, Typst/pcli/score/apply/resume mutation 없음
- 무시: 없음
