# Step 005 — Completion check: lastMet.test.ts — spy restore hygiene, fallback describe split

Cycle: 22
Pass: 6
Files Changed: web/src/lastMet.test.ts

## Advisor Verdict
PASS (after fix applied)

## Advisor Feedback
Concern 1 — toLocaleString spy not restored: vi.spyOn with no afterEach(vi.restoreAllMocks) and no restoreMocks:true in config. The spy is never undone. Cross-file leak does not manifest today (vitest 2.x per-file module isolation), but within lastMet.test.ts itself any future test added after the spy test that relies on real toLocaleString would silently get the spy. File imported afterEach but never used it — a tell that restore wiring was intended and dropped. Fix: add afterEach(() => vi.restoreAllMocks()) and remove the unused beforeEach import.

Concern 2 — separate describe("LAST_MET_FALLBACK export") block: sufficient. The two describes assert different things (behavioral contract vs copy pinning). Keeping them separate is the right separation — if copy changes, only the copy test fails. No change needed.

## Sonnet Response
- 적용: afterEach(() => vi.restoreAllMocks()) 추가, 미사용 beforeEach import 제거.
- 무시: 없음. Concern 2 (describe 분리)는 변경 불필요로 Advisor 확인.
