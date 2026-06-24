# Step 001 — Manual Preparation Entry A (POST /api/events/:id/preparations)

Cycle: 46
Pass: 2
Files Changed: (approach check — no files yet)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
1. Race-safe here: better-sqlite3 is synchronous and single-connection on Pi-local; the whole tx runs atomically with no interleaving. Check-then-insert is fine. Still, keep onConflictDoNothing on the link insert as a cheap correctness backstop (UNIQUE guard) — not required, but defends future async.

2. Correct. Scoping find to kind='item' matches plan ("reuse only item, never convert knowledge"). New item row with same name is intended.

3. Risk — flag. Stored tentative link returned as preparations entry. Two concerns: (a) GET's findPreparationLinkData (cycle-45) — confirm it filters firmness/source so a tentative link surfaces consistently in scheduleBrief; mismatch = item shows here but not in brief. (b) reusedLink=true but firmness≠hard may confuse "직접 추가" semantics. Plan says don't promote; acceptable, but verify GET render parity.

4. Sound. 201 = new event link created (resource reuse irrelevant); 200 = exact link pre-existed. Idempotent and HTTP-correct.

5. Correct. Zod `.trim()` transform runs before `.min(1).max(120)` checks. Blank-after-trim and overlong-after-trim rejected. Ensure `.min/.max` chained after the transform (z.string().trim().min(1).max(120)), not before.

Top risk: #3 GET/POST render parity — verify cycle-45 link filter includes the firmness states your insert/reuse can produce.

## Sonnet Response
- 적용 (1): Add onConflictDoNothing to the link insert as a UNIQUE backstop even though synchronous better-sqlite3 makes the single-transaction check-then-insert race-safe. Cheap, future-proof.
- 적용 (2): Confirmed — scope find to kind='item'; a same-name knowledge row is not reused/converted.
- 적용 (3): MUST verify before implementation — read cycle-45 findPreparationLinkData to confirm which firmness states it surfaces in scheduleBrief.preparations. If it filters to hard-only (or otherwise excludes tentative), a reused tentative link would show in the POST response but NOT in the GET brief, breaking render parity. Resolve the policy explicitly during implementation.
- 적용 (4): Keep 200=reusedLink / 201=new link. resource reuse does not affect status.
- 적용 (5): Order as z.string().trim().min(1).max(120) so trim runs before length bounds.
- 무시: none.

## Sonnet Resolution (NEEDS_REVIEW → cleared)
- Risk #3 closed: `findPreparationLinkData` (resources.ts) filters ONLY by (targetType, targetId) — no firmness filter. A reused tentative event_direct link DOES appear in GET `scheduleBrief.preparations`. POST response and GET brief render the same link → parity holds.
- Adopting advisor recs: add `onConflictDoNothing` backstop on the link insert (cheap UNIQUE safety) alongside the pre-check; Zod `z.string().trim().min(1).max(120)`; 200=reusedLink, 201=new link; kind='item' scoping intentional.
