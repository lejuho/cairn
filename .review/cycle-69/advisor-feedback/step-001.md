# Step 001 — Approach check: Composer Core A (unified composer state, mode routing, 고급 입력)

Cycle: 69
Pass: 1
Files Changed: (approach only) — planned: web/src/InputHub.tsx(+test), web/src/styles.css, docs/composer-roadmap-cycles-68-71.md, docs/codebase-map.md

## Advisor Verdict
PASS (1 NEEDS_REVIEW resolved)

## Advisor Feedback
1. PASS. Single `composer` state removes dual-state divergence; discriminated-union `result` (kind-tagged) lets ResultCard branch cleanly; `submitting`/`error` per-composer (one in-flight submit); drop `capture` entirely (grep first — no surviving consumer); one textarea across modes fine.
2. NEEDS_REVIEW (confirm task loadData). event→flat-event {text,now}+loadData ✓; thread→/threads/draft {text} ✓; task→/tasks {title:text} ✓; clear text/keep mode/keep-text-on-failure ✓; empty + whitespace `.trim()` guard ✓; role=alert ✓. Gap: does /input list tasks? If yes task success needs loadData; if only unscheduled events, skip.
3. PASS. Reuse cycle-68 ResultCard (no fork); capture branch must stay byte-identical to 68; thread card 「스레드 열기」 real <a> href /threads/:id; task 「Today에서 보기」/today; warnings render defensive (may be empty).
4. PASS. Mode switch: clear result+error (stale cross-mode state confusing), keep text (user may reclassify). Segments aria-pressed+data-mode+44px; submit single button aria-label 만들기.
5. PASS. advancedOpen=false default, toggle aria-expanded, formSection gated; manual tests prepend 고급 입력 click; capture tests → Composer 일정 (label change). Low risk to unscheduled list/slot apply/domain filter/4 states (untouched by gating the form).

## Sonnet Response
- 적용 (1,3,4,5): unified `composer` state(mode/text/submitting/error/result discriminated union) capture 대체 + captureSection/handleCapture 제거(capture 소비처는 둘뿐 — grep 확인); ResultCard 재사용, capture 분기는 cycle-68과 동일(scheduled→Today /today, raw→날짜 잡기 dismiss+loadData); thread→스레드 초안(<a> href /threads/:id, counts+warnings 방어적); task→할 일(/today); 모드 전환 시 result+error clear, text 유지; 세그먼트 aria-pressed+data-mode+44px, submit aria-label "만들기"; formSection은 advancedOpen(default false) + aria-expanded 토글 뒤로.
- 적용 (2 — 해결): /input은 unscheduledEvents + threads만 렌더하고 **task는 목록에 없음** → task 성공 시 loadData 불필요(스킵). task 카드 primary는 "Today에서 보기"(/today, due/2분 task가 표시되는 곳). event 모드만 loadData(새 미정 이벤트가 unscheduled 목록에 나타나야 함).
- 무시: 없음.
