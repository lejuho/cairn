# Codex Review v2

## Verdict
BLOCKED

## Findings
### ISSUE-4 [MEDIUM] Codebase map still describes mutation fetches as direct
- 위치: `docs/codebase-map.md:213`
- 분석: The map says Today/InputHub mutation fetches remain direct and are deferred. The fix commit migrated every direct fetch in `Today.tsx` and `InputHub.tsx` to `apiJson`; enumeration now finds the raw `fetch` call only inside `web/src/api.ts`.
- 영향: `docs/codebase-map.md` is the required first-stop navigation catalog and is now materially false about the frontend API boundary. This violates the cycle's documentation contract and AGENTS.md Context Discipline.
- 수정 방향: Update the Web Map to state that Today/InputHub top-level reads, secondary reads, and mutations use `apiJson`, while accurately naming any intentionally unmigrated screens such as Thread routes.

### ISSUE-5 [MEDIUM] Advisor step 003 is not tracked by git
- 위치: `.review/cycle-20/advisor-feedback/step-003.md`
- 분석: The file contains the review-v1 approach feedback and Sonnet response, but `git status` shows it as untracked. `git ls-files` includes step 004 but not step 003.
- 영향: Merging the branch would drop required Advisor feedback externalization from cycle history, breaking the cycle artifact contract.
- 수정 방향: Add and commit `step-003.md` with the implementation correction. Do not rewrite its contents unless required by the advisor-feedback format.

## Previous Issue Status
- ISSUE-1: RESOLVED — `apiJson` now classifies visible HTTP 302, with exact unit coverage.
- ISSUE-2: RESOLVED — Today and InputHub API calls are migrated to `apiJson`; raw fetch enumeration is centralized in `web/src/api.ts`.
- ISSUE-3: RESOLVED — InputHub Access error, recovery navigation, and generic error behavior have UI coverage.

## Regression Check
No functional regression found in the correction diff. Access errors remain typed, application envelopes remain caller-owned, and existing UI flows pass.

## Sprint Contract Check
- API fetch wrapper detects Cloudflare Access redirect/HTML/302/401/403: PASS.
- API fetch wrapper parses normal JSON success: PASS.
- Generic API errors remain distinct from Access errors: PASS.
- Today top-level Access recovery UI: PASS.
- InputHub top-level Access recovery UI: PASS.
- Recovery action performs full-page navigation to current URL: PASS.
- Planned Today/InputHub API calls use the shared fetch boundary: PASS.
- No server/DB/migration/LLM/Telegram/GCal/Caddy changes: PASS.
- `docs/codebase-map.md` accurately reflects the final implementation: BLOCKED by ISSUE-4.
- Advisor feedback artifacts are preserved: BLOCKED by ISSUE-5.

## Automatic Checks
- `corepack pnpm db:generate`: PASS.
- `corepack pnpm test:integration`: PASS.
- `corepack pnpm verify`: PASS.
- `git diff --check`: PASS.

## Changes Outside Plan
None found.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED (Executor 응답, 파일 끝에 append)

### Issue Classification
- ISSUE-4: APPLY
- ISSUE-5: APPLY

### Applied

RESOLVED: ISSUE-4 — codebase-map.md API boundary 기술 현행화
- `docs/codebase-map.md:212`: detection order에 302 추가
- `docs/codebase-map.md:213`: "top-level loads만 사용, mutation은 deferred" → "Today/InputHub 모든 API 호출 (top-level, secondary reads, mutations) apiJson 사용. Thread 계열은 미이전."

RESOLVED: ISSUE-5 — step-003.md git 추적 복구
- `.review/cycle-20/advisor-feedback/step-003.md` git add + commit (내용 수정 없음)

자동 체크: lint ✅ / tsc ✅ / test ✅ / build ✅
