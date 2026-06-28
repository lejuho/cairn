# Step 001 — Approach check: Watcher+Record Composer modes (shared module, 5 modes, both pages)

Cycle: 71
Pass: 1
Files Changed: (approach) — planned: web/src/composerModes.tsx(new), CreationComposer.tsx, InputHub.tsx(+test), Today.tsx(+test), styles.css, docs/*

## Advisor Verdict
PASS (1 must-fix: per-mode text requirement)

## Advisor Feedback
1. Module shape OK: skill allows network in a dedicated data layer; co-locating pure panels fine IF panels never call apiJson; createWatcher/createRecord no React/hooks. Split if >3 panels+3 fns. Hold CreationComposer purity (no apiJson/href). PASS.
2. detail?:ReactNode slot + submitDisabled? keeps it presentational. final disabled = !text.trim()||submitting||submitDisabled. VERIFY text requirement per mode (watcher label=text? then fine). Keep modes union exhaustive. PASS-verify.
3. Page state + submit branches + discriminated ComposerResult sound. Make result switch exhaustive. refresh() only on success path. Record href: use a real route or plain secondary text (no dead href). PASS.
4. Targets: /input merge dayEvents+unscheduled, /today dayEvents; dedupe by id + title fallback; empty→disabled+"기록할 이벤트가 없어"; keep validity as pure fns (subtypeValid/recordValid); reset recordTargetId if selected disappears. PASS.
5. Don't touch /watch sheet, cycle-69/70 modes, Today queue/priority. Mode switch: clear result+error keep text; decide keep subtype/fields/target (recommend keep). reverse-plan: fixed step rows add/remove min1 cap, validity=targetDate+≥1 step label. PASS.

## Sonnet Response
- 적용 (must-fix): 모든 5모드 central text 필수 — watcher text=label, record text=annotation. 기존 !text.trim() 규칙 그대로; submitDisabled가 subtype-field/record-target 추가 게이팅. text 규칙 모드별 분기 불필요.
- 적용: composerModes.tsx에 data-layer(createWatcher/createRecord, apiJson) + presentational(WatcherFields/RecordTargetSelect, no apiJson) + pure validity(watcherSubtypeValid/recordValid). CreationComposer는 detail?:ReactNode + submitDisabled?만 추가, apiJson/href 없음. ComposerResult discriminated += watcher|record, result 카드 분기 망라. refresh는 success path만. record 결과 secondary는 plain text(dead href 방지); Today primary dismiss+refresh, /input primary href /today(실route). targets dedupe by id + title fallback, empty→disabled. mode switch: result+error clear, text+subtype/fields/target 유지(덜 놀람). reverse-plan steps add/remove min1 cap 8(기존 route max), validity targetDate+≥1 step label.
- 무시: 없음.
