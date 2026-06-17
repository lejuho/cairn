---
step: "001"
kind: "approach"
topic: "Threads read-only spine — shared schemas, /threads/:id routing, NOW split"
---

## Advisor Feedback
1. Shared schemas: new shared/src/threads.ts. Reuse existing EventRowSchema/TaskRowSchema via z.array(...) — do not redefine inline. Define ThreadRowSchema, CreateThreadRequestSchema (omit id/createdAt/status), ThreadSummarySchema (row + eventCount/taskCount), ThreadDetailSchema (row + events[] + tasks[] + progress). Export from index barrel.
2. Routing: option (a) — path.startsWith("/threads/") then parseInt trailing segment, guard Number.isFinite. No router dep. Match manual-compare style.
3. NOW split: client-side new Date(). Detail API stays paramless. Compute split in component, not server. Spine is read-only render-time split.
Verify before coding: confirm EventRowSchema/TaskRowSchema location and index barrel exports.

## Sonnet Response
- 적용 1: ThreadDetailSchema reuses EventRowSchema/TaskRowSchema via z.array; CreateThreadRequestSchema omits id/createdAt/status. New shared/src/threads.ts + barrel export.
- 적용 2: startsWith("/threads/") + parseInt + Number.isFinite guard; no router dependency.
- 적용 3: client-side new Date() for future/past split; detail API stays paramless.
- 무시: none.
