# Soft Remove / Archive Roadmap — Cycles 81-84

Status: Cycle 81 promoted and active; later cycles are candidates.

## Why This Exists

Cairn is local-first and evidence-preserving. Most objects should not disappear
silently because they feed Today, feasibility, thread progress, mirror views,
people history, and settlement. The product needs explicit remove controls, but
the default should be soft-remove/archive semantics before hard delete.

Current safe substitutes:

- event → `cancelled`
- task → `dropped`
- watcher → `armed=false` / disarmed
- thread relation link → existing edge delete

## Cycle 81: Operational Soft Remove Controls A

Branch when promoted: `feature/cycle-81-soft-remove-controls-a`
Skills when promoted: `backend-fastify, frontend-react-pwa`
Status: promoted + active 2026-06-29 (`.review/cycle-81/`)

Expose explicit task drop controls on operational task surfaces while preserving
event cancel and watcher disarm as the current safe remove semantics.

Scope:

- Today two-minute task drop.
- Today due-task prompt permanent drop, distinct from one-day dismiss.
- Thread detail active task drop.
- No hard delete routes for core domains.

## Cycle 82: Thread Archive / Drop A

Status: candidate

Add an explicit thread-level archive/drop control around the existing
`ThreadStatus` model. This needs careful handling of thread lists, Today domain
filters, rollups, settlement, missing-node suggestions, and child containment.

Out of scope until promoted:

- deleting thread rows;
- cascading events/tasks/resources;
- hiding evidence from mirrors.

## Cycle 83: Person Archive / Merge A

Status: candidate

People are graph centers, not simple rows. Before any delete, add a safe archive
or merge flow that preserves event_people history and resource source-person
provenance.

Out of scope until promoted:

- hard-delete people;
- orphaning event_people/resource source rows;
- automatic duplicate detection.

## Cycle 84: Hard Delete Policy / Export A

Status: candidate

Only after soft-remove behavior is stable, define whether Cairn needs hard delete
at all. If yes, require explicit confirmation, export/backup guidance, and
module-by-module cascade tests.
