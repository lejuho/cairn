# Step 001 — Approach check: resource-promotion-suggestions-a

Cycle: 39
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW

## Advisor Feedback
Verdict on all three:

**1. CandidateKey — include occurrences.**
- `${normalizedName}::${kind}` alone is insufficient: it survives occurrence drift, so a stale set passes the check.
- Spec "rejects stale or ineligible candidates" requires detecting occurrence-set change.
- Use `name::kind` as identity, plus a hash of sorted `(targetType,targetId)` occurrences for staleness.
- Compare both: identity locates, hash gates mutation.

**2. Suppression — pure service, inject link rows.**
- Keeps service unit-testable; matches "pure where possible" layering.
- Repository fetches link rows; service filters. Avoid JOIN coupling suggestion logic to SQL.
- Suppress only when every occurrence is already linked.

**3. Atomicity — re-run (1)-(2) inside transaction.**
- Cheap reads; correctness shouldn't rest on "single-user" assumption.
- better-sqlite3 is synchronous/serialized, so re-read in-tx is near-free and removes the race entirely.
- Read-outside-only is sufficient functionally but brittle; re-check in-tx is the right guard.

## Sonnet Response
- 적용 (point 1): candidateKey = `name::kind` as identity + hash of sorted `(targetType,targetId)` occurrences. Identity locates the candidate; occurrence-hash gates the mutation. Stale comparison uses both.
- 적용 (point 2): suppression in pure service. Repository fetches resource_link rows; service injects them and filters out suggestions where every occurrence is already linked to the same name+kind resource. No SQL JOIN coupling.
- 적용 (point 3): re-run recompute + stale check inside the Drizzle transaction. better-sqlite3 is synchronous/serialized so the in-tx re-read is near-free and closes the race deterministically rather than relying on the single-user assumption.
- 무시: 없음 (all three verdicts adopted as-is; they align with plan's "pure where possible" layering and "rejects stale or ineligible candidates" contract).
