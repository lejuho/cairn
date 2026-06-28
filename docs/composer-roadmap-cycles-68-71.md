# Composer Roadmap: Cycles 68-71

Status: temporary roadmap document
Created: 2026-06-28

This document concatenates the intended Composer cleanup roadmap for cycles
68-71 so agents can read the whole direction before individual cycles are
promoted into `.review/cycle-N/plan.md`.

Cycles 68 and 69 have been promoted, implemented, and merged. Cycle 70 is now
promoted through `.review/cycle-70/plan.md`. Cycle 71 remains a roadmap section
only and must not be treated as an active cycle plan until it is explicitly
promoted.

## Product Direction

Cairn currently has many useful objects, but their creation feedback and
viewing locations are fragmented:

- events can appear in Today, InputHub, thread nodes, and event detail sheets;
- thread drafts are created from `/threads/new`;
- watchers are created and managed in `/watch`, but surface in Today and
  Mirror;
- annotations and diary entries are split between event detail and Mirror;
- people and resources act as context, but they are reached from several
  surfaces.

The roadmap keeps the existing object homes while making creation and result
feedback coherent:

- Composer creates objects.
- Today is the processing queue.
- Threads, People, Watch, and Mirror remain object homes or analysis homes.
- Creation result cards tell the user what was created, where it lives, and
  what to do next.

## Cycle 68: Creation Result Cards A

Branch when promoted: `feature/cycle-68-creation-result-cards-a`
Skills when promoted: `frontend-react-pwa`

### Goal

Unify creation success feedback without restructuring input flows. After any
covered creation action, the user should see the same result-card shape:

- object kind;
- title or label;
- status line;
- primary action;
- secondary explanation.

### Scope

Covered surfaces:

- `/input` quick capture success;
- `/input` manual event success;
- `/input` manual task success;
- `/threads/new` natural-language thread draft success;
- `/watch` watcher create success.

Out of scope:

- Today quick capture refactor;
- Composer mode redesign;
- watcher/record Composer modes;
- backend routes;
- DB migrations;
- shared schema changes unless needed only for frontend typing.

### Expected Behavior

Result-card object kinds:

- `일정`
- `미정 일정`
- `할 일`
- `스레드 초안`
- `Watcher`

Primary actions:

- unscheduled event: `날짜 잡기`;
- scheduled event or task: `Today에서 보기` or another existing refresh/view
  action if the object has no dedicated route;
- thread draft: `스레드 열기`;
- watcher: `지켜볼 것에서 보기`.

All result cards use semantic tokens, 44px touch targets, and `role="status"`
or equivalent accessible status semantics. Existing error states stay local and
unchanged.

## Cycle 69: Composer Core A

Status: PROMOTED + implemented + merged (`.review/cycle-69/`). `/input` is now
a mode-selected Composer; manual event/task forms moved behind `고급 입력`.
Branch: `feature/cycle-69-composer-core-a`
Skills: `frontend-react-pwa`

### Goal

Make `/input` primarily a Composer screen. Users should choose a creation mode
and type natural language into one central input instead of deciding between
several unrelated forms.

### Scope

Composer modes:

- `일정`
- `스레드`
- `할 일`

The existing manual forms remain available behind `고급 입력`. The cycle reuses
Cycle 68 result cards.

Out of scope:

- Watcher Composer mode;
- record/diary Composer mode;
- Today quick capture adoption;
- backend schema or route redesign.

### Expected Behavior

Mode behavior:

- `일정` uses existing flat capture / event creation capabilities.
- `스레드` uses existing thread draft creation.
- `할 일` uses existing task creation.
- Mode selection is explicit and visible; no hidden auto-routing is required in
  this A-slice.

The screen should still expose current manual event/task affordances, but they
are secondary and collapsed by default.

## Cycle 70: Today Composer Adoption A

Status: PROMOTED (`.review/cycle-70/`). Today quick capture should be replaced
by a compact shared Composer entry while Today remains the processing queue.
Branch: `feature/cycle-70-today-composer-adoption-a`
Skills: `frontend-react-pwa`

### Goal

Reduce duplicate input surfaces by making Today use a compact shared Composer
entry while preserving Today as the processing queue.

### Scope

- Replace Today quick capture UI with the shared compact Composer affordance.
- Keep Today cards, event detail, conflict resolution, slot candidates,
  watcher cards, and feasibility controls unchanged.
- Reuse Cycle 68 result cards for creation feedback.

Out of scope:

- changing Today card priority;
- moving Today object detail behavior to new pages;
- adding watcher or record Composer modes;
- backend changes.

### Expected Behavior

Today remains a queue of things that need attention. The compact Composer is
only an entry point for creation. It must not make Today look like a generic
chat history.

## Cycle 71: Watcher And Record Modes A

Branch when promoted: `feature/cycle-71-watcher-record-modes-a`
Skills when promoted: `frontend-react-pwa, backend-fastify` only if backend
changes are actually needed

### Goal

Add the next two object modes after the core Composer is stable: watcher
creation and record capture.

### Scope

Composer modes:

- `Watcher`
- `기록`

Watcher mode connects to existing watcher creation flows:

- date-threshold watcher;
- reverse-plan watcher;
- manual-exogenous watcher.

Record mode uses existing event annotation boundaries. Standalone diary storage
is out of scope unless a later plan defines a new backend contract.

Out of scope:

- automatic watcher-B crawling;
- n8n pipeline integration;
- new standalone diary table;
- rewriting Mirror.

### Expected Behavior

Watcher creation result cards link to `/watch`. Record creation result cards
make clear where the record will be visible:

- event-linked notes appear in event detail;
- diary/reflection views remain in `/mirror`.

## Promotion Rules

Before promoting a roadmap section to a real cycle:

- create exactly one `.review/cycle-N/plan.md`;
- create `.review/cycle-N/status.txt` with `in_progress`;
- add a concrete branch line;
- keep the cycle scope narrow;
- do not implement future roadmap items inside an earlier cycle.

The active promoted cycle is Cycle 70. Cycle 71 remains roadmap-only until a
future `.review/cycle-N/plan.md` promotes it.
