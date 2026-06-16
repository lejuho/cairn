---
step: "001"
type: "Approach check"
topic: "Cycle 2 Local Today API full implementation"
---

## Query

Approach check: Cycle 2 Local Today API full implementation, 핵심 판단 지점 3개

1. Shared Zod schemas 구조 — 단일 `today.ts` vs 엔티티별 분리
2. 백엔드 레이어 — Repository → Service → Route 3단 vs Repository 없이 Service에서 직접
3. 프론트엔드 Today 교체 전략 — Today.tsx 신규 vs TodayQuiet.tsx 인플레이스 수정

## Advisor Response

1. **Zod schemas**: Split by entity. Create `shared/src/events.ts`, `tasks.ts`, `watchers.ts`, `today.ts`. Today response composes the three. Single-file collapses cohesion; entity split matches DB tables and scales to later cycles.

2. **Layering**: Keep Repository → Service → Route. Repository = Drizzle queries per table; Service = Today aggregation/business rules. Integration tests hit Service against real DB; Repository isolates SQL so aggregation logic stays testable and table changes localize. Don't skip it.

3. **Frontend**: Create `Today.tsx` with 4 states (loading/error/empty/loaded), keep `data-testid="today-quiet"` on its root, update `App.tsx` import. Preserves `App.test.tsx`. Delete `TodayQuiet.tsx` only after test passes green.

Caveat: confirm the existing testid contract before deleting.

## Decision

APPLY all three recommendations.
- Entity split adopted for shared schemas
- Repository layer included
- Today.tsx 신규 생성, quiet state에 data-testid="today-quiet" 유지

---

## Completion Check

Cycle: 2
Pass: 2
Files Changed: shared/src/events.ts, shared/src/tasks.ts, shared/src/watchers.ts, shared/src/today.ts, shared/src/index.ts

### Query

Completion check: Step 001 Shared Zod schemas, 회귀 우려 지점 2개

1. TodaySurfaceSchema.cards discriminated union이 프론트에서 switch(card.kind) 내로우링 가능한가?
2. EventRowSchema.start/end가 z.string().nullable()(loose)인데 CreateEventRequestSchema는 z.string().datetime()(strict) — DB row 반환 시 클라이언트 파싱 실패 우려는?

### Advisor Verdict
NEEDS_REVIEW

### Advisor Feedback
1. Spec intent: Surface shows only actionable, valid cards; Row schemas validate persisted/output rows; Request schemas validate untrusted input.
2. Concern 1: PASS — discriminatedUnion("kind") emits a literal tag per variant; `switch(card.kind)` narrows correctly in TS.
3. Concern 2 asymmetry: Request strict-datetime is correct (reject bad input at boundary).
4. But EventRowSchema.start/end as bare `z.string().nullable()` is too loose: it neither validates datetime format nor justifies null.
5. Risk: a next_event card requires a real start; nullable/unformatted start leaks invalid state the surface shouldn't render, and silently passes parse.
6. Fix: Row start/end → `z.string().datetime({offset:true})`; allow null only where domain truly permits (e.g. all-day/open-ended), not blanket.

Verdict: NEEDS_REVIEW

### Sonnet Response
- 적용: Concern 1 — discriminated union 구조 그대로 유지. switch(card.kind) 내로우링 검증됨, 변경 불필요.
- 적용(부분): Concern 2 — EventRowSchema.start/end를 `z.string().datetime({ offset: true }).nullable()`로 강화하여 DB row 반환 시 포맷 검증을 추가하고 null은 명시적 도메인 케이스(all-day/open-ended)로만 허용. 백엔드 Repository가 SQLite TEXT를 ISO-8601로 정규화하는지 step 002에서 확인 필요.
- 유보: source/status/createdAt/updatedAt 등 나머지 nullable 필드의 추가 제약은 본 step 범위 외 — 이들은 surface 렌더 invariant에 직접 관여하지 않으므로 DEFER. start/end만 surface(next_event card)가 실재 값을 요구하는 필드라 우선 적용.
