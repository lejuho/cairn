---
step: 005
type: approach
topic: Cycle 4 — Annotation Intake + LLM parse fallback (cross-cycle ref)
---

## Query
Approach check: POST /api/events/:id/annotations — raw 저장 후 LLM 파싱
- 판단 1: annotations DB table updated_at 없음 — update 패턴 충분한가?
- 판단 2: LLM gateway DI — buildServer에 gateway 파라미터 추가 vs 다른 방식?
- 판단 3: annotations.reason_tags TEXT(JSON) — stringify/parse를 어느 레이어에서?

## Response (Advisor)
PASS with decisions:
1. No updated_at 추가 — 기존 컨벤션 유지. "Out of scope: new annotation tables/columns" 준수.
2. Gateway DI = buildServer(db?, gateway?) 파라미터 — 기존 db DI 패턴과 일관.
3. JSON 경계 = repository 레이어 — JSON.stringify on insert/update, parse on read.
   watchers.ts 패턴 동일. Service는 domain-typed string[] 유지.
추가: ParsedAnnotationSchema가 DB CHECK 제약 조건 강제 필요 (outcome ∈ {done,cancelled,moved,late}, energy 1-5).
검증 실패 → raw_stored fallback.

## Sonnet Response
NOTE: cycle-4 Annotation Intake 작업 중 호출된 Advisor feedback. 원본은
`.review/cycle-4/advisor-feedback/step-001.md`에 저장됨.
cross-cycle 추적 불일치로 인해 cycle-5 step 파일로도 기록.

## Decision
APPLY 전부. 상세 구현은 cycle-4 step-001.md 참조.
