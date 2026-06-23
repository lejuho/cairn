# Step 001 — Approach check: resources/resource_links schema, idempotent links, resource-focus route placement

Cycle: 38
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Confirm point 1: target_id plain integer, no FK (SQLite can't FK polymorphic); source_person_id real nullable FK to people.id. Add CHECK on target_type enum.
2. Confirm point 2: onConflictDoNothing on uniqueIndex(resource_id,target_type,target_id) + SELECT to return stable existing row. Avoid INSERT OR REPLACE (mutates id). Matches repo idempotency intent.
3. Place resource-focus in new resources route file; keep threads.ts cohesive (SRP). Cross-namespace read does not justify bloating threads route.
4. Wrap insert+select in one transaction (atomic idempotency, avoid race).
5. Approach sound — proceed.

## Sonnet Response
- 적용 (1): `resource_links.target_id` = plain integer, no FK; `resources.source_person_id` = nullable real FK to `people.id`. Add CHECK constraint on `target_type in ('event','task','thread')` (matches existing thread_links_kind_check pattern). Also add CHECK on `kind` and `firmness` enums for consistency.
- 적용 (2): `uniqueIndex` on `(resource_id, target_type, target_id)` + `.onConflictDoNothing()` insert + follow-up SELECT returning the stable existing row. Reject INSERT OR REPLACE (mutates id, violates plan "existing link 반환").
- 적용 (3): resource-focus route goes in a NEW resources route file (registerResourceRoutes), NOT threads.ts. Resolves judgment point 3 in favor of route cohesion (SRP) over /threads/:id namespace locality. The path stays `/api/threads/:id/resource-focus` but is registered from the resources route module.
- 적용 (4): Wrap link insert + select in a single Drizzle transaction for atomic idempotency under concurrency.
- 무시: 없음.
