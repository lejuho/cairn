# Step 001 — Approach check: Today Composer Adoption A (extract CreationComposer, Today compact Composer)

Cycle: 70
Pass: 1
Files Changed: (approach only) — planned: web/src/CreationComposer.tsx(new), InputHub.tsx, Today.tsx(+test), styles.css, docs/composer-roadmap-cycles-68-71.md, docs/codebase-map.md

## Advisor Verdict
PASS (all 5)

## Advisor Feedback
1. CreationComposer owns ONLY modes buttons/textarea/submit/Enter-submit + disabled=!text.trim()||submitting; emits onModeChange/onTextChange/onSubmit; NO state/apiJson/refresh/result/error. Move ComposerMode+ComposerModeConfig types here; keep ComposerResult in pages. compact drives textarea rows (thread=3 else 1) for InputHub parity. PASS.
2. InputHub swap inline composerSection for <CreationComposer title="새로 만들기" modes=COMPOSER_MODES/>; keep page state/handler/result/error. aria-labels (만들기 입력/만들기/만들기 종류), data-mode, aria-pressed verbatim → cycle-69 tests pass. onModeChange guard stays page-side (clears result+error keeps text). PASS.
3. Today composer mirrors InputHub; route event→capture+refresh, thread→draft, task→tasks+refresh. Remove capture state/handleCapture/savedMsgTimer/savedMsg AND dead flatCapture+QuickCaptureResult. Add ResultCard import. PASS.
4. composer is component-level state above quiet/live branch → survives refresh() view flip. MUST render CreationComposer+result card in BOTH quiet+live blocks. scheduled→dismiss+refresh; raw→「날짜 잡기」 href /input; thread→/threads/:id; task→dismiss+refresh. scheduled/task already refresh so card refresh redundant-harmless. PASS.
5. No network in presentational; manual sheet/cards/conflict/slots/feasibility/DomainFilter untouched; mode-switch clears result+error keeps text; empty/whitespace disabled. Gaps: delete dead flatCapture/QuickCaptureResult (else lint unused); testIds fine (separate route); preserve data-mode. PASS.

## Sonnet Response
- 적용 전부: presentational CreationComposer(no state/api/result/error, compact→rows); InputHub aria-label/data-mode 동일 + onModeChange guard page-side; Today composer mirror + capture/handleCapture/savedMsgTimer/savedMsg/flatCapture/QuickCaptureResult 제거 + ResultCard import; quiet+live 둘 다 composer+result 렌더; raw→날짜 잡기 href /input; mode-switch result+error clear text 유지; empty/whitespace disabled.
- 무시: 없음.
