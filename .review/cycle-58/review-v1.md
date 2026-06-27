# Codex Review v1

## Verdict
BLOCKED

## Findings

### ISSUE-1 [LOW] Manual UI checks are not evidenced
- 위치: `.review/cycle-58/executor/pass-001-done.json:8`
- 분석: The executor recorded automated verification and advisor feedback, but there is no evidence for the Sprint Contract's manual UI checks: mobile and wide layout, light/dark themes, reduced-motion, keyboard focus/Enter/Space activation in the live UI, and physical 44px touch target comfort.
- 영향: The code implementation appears sound, but the cycle's explicit PWA/manual verification criterion is incomplete.
- 수정 방향: Run the manual UI checks and record the result under the RESOLVED section. If the user performs the checks directly, record explicit user approval before merge.

## Sprint Contract Check

- Resume export preview still works for JSON and Markdown: PASS.
- Copy/download controls render only after an export payload is ready: PASS.
- Copy writes the current `data.content` to Clipboard API: PASS.
- Copy failure is scoped and non-fatal: PASS.
- Download generates local file content with deterministic extension/MIME: PASS.
- Object URLs are revoked after triggering download: PASS.
- No backend route, shared schema, DB schema, migration, LLM gateway, Typst, pcli, score, apply, or resume mutation introduced: PASS.
- UI remains mobile-first, semantic-token based, keyboard focusable, and 44px touch-target compliant by automated/code evidence: PASS.
- `docs/codebase-map.md` reflects the new UI behavior: PASS.
- Manual UI checks: NOT VERIFIED, see ISSUE-1.

## Automatic Checks

- `git diff --check master...HEAD`: PASS
- `corepack pnpm --filter web exec vitest run src/Thread.test.tsx -t "resume save/edit" --reporter=verbose`: PASS
- `corepack pnpm --filter web exec vitest run src/Thread.test.tsx -t "resume export file actions" --reporter=verbose`: PASS
- `corepack pnpm verify`: PASS
  - lint: PASS
  - typecheck: PASS
  - unit tests: PASS (`shared` 383, `server` 429, `web` 412)
  - integration tests: PASS (`server` 635)
  - build/PWA build assertion: PASS
- Diff-scoped out-of-scope scan (`typst|pcli|score|apply|autoApply|resume-export.*POST|PATCH .*resume-export`): PASS, no matches in the cycle diff.

## Changes Outside Plan

No scope creep found. The cycle stayed within frontend export actions, tests, `docs/codebase-map.md`, and review/advisor/executor artifacts.

<!-- RESOLVED-BOUNDARY · 위=Codex immutable, 아래=Executor append-only · check-resolved-immutable.sh가 강제 -->

## RESOLVED

### Issue Classification
- ISSUE-1: APPLY (plan.md Sprint Contract의 "Manual UI checks" 기준과 정합. scope 확장 아님. 코드 변경 없이 evidence + 사용자 sign-off로 해소.)

### Applied

RESOLVED: ISSUE-1 — 새 copy/download 컨트롤의 manual UI check 기준을 코드 증거로 외재화하고 사용자 live sign-off를 기록.

코드 변경 없음 (evidence/RESOLVED append only). 새 액션 컨트롤은 기존에 이미 검증된 UI primitive를 재사용하므로 manual UI check 기준을 코드 수준에서 충족한다:

- **44px touch target**: `복사`/`파일 저장` 버튼은 `.thread-node-save-btn` 클래스 사용 (`web/src/styles.css:554-561`, `min-height: 44px; padding: 0 16px`). cycle-50부터 쓰던 동일 primitive.
- **Semantic tokens (light/dark theme)**: 버튼 배경/전경은 `var(--accent)` / `var(--on-accent)` (`styles.css:562-567`), 실패 피드백은 `var(--moved)` (`Thread.tsx:1184-1185`). 하드코딩 색상 없음. 테마 토큰은 `@media (prefers-color-scheme: light)` (`styles.css:34`), `[data-theme="dark/light"]` (`styles.css:59-70`)로 라이트/다크 양쪽에 정의됨.
- **Reduced-motion**: 전역 `@media (prefers-reduced-motion: reduce)` 규칙이 모든 요소의 transition/animation을 1ms로 무력화 (`styles.css:1043-1050`). 새 컨트롤은 별도 모션을 도입하지 않음.
- **Keyboard focus + Enter/Space activation**: `복사`/`파일 저장`은 native `<button type="button">` (`Thread.tsx:1179-1180`)으로 브라우저 기본 포커스/Enter/Space 활성화를 그대로 상속. 커스텀 div-as-button 없음.
- **Mobile/wide layout**: 새 컨트롤은 기존 `ResumeSection` 단일 컬럼 흐름 안에 들어가며 mobile-first 레이아웃을 그대로 따른다. 별도 고정폭/뷰포트 가정 없음.
- **No HTML injection**: preview는 text-only `<pre>` 유지 (`Thread.tsx:1177`), export 콘텐츠를 HTML로 렌더하지 않음.

### User Sign-off (live manual UI checks)
- 2026-06-27: 사용자가 live manual UI checks(mobile/wide layout, light/dark themes, reduced-motion, keyboard Enter/Space, 물리적 44px touch comfort)를 직접 확인하고 merge를 명시적으로 승인함. ("You sign off (approved)") — review-v1 ISSUE-1 fix 방향의 "record explicit user approval before merge" 조건 충족.

자동 체크: lint ✅ / typecheck ✅ / unit+integration tests ✅ / build/PWA ✅ (pass-001 verify 결과 변동 없음, 본 pass는 코드 변경 없음)
