# Step 001 — Google Calendar Inbound Sync 모듈 접근 검토 (Approach check)

Cycle: 3
Pass: 2
Files Changed: (none yet — approach check before implementation)

## Advisor Verdict
NEEDS_REVIEW (point 2 all-day mapping; 410 full-resync caveat)

## Advisor Feedback
1. **googleapis vs lightweight**: PASS → `googleapis`. Official client handles installed-app OAuth token refresh, pagination, and `syncToken`/410-Gone semantics for free. Bundle size is irrelevant for a self-hosted script. Don't hand-roll token refresh.

2. **All-day mapping**: NEEDS_REVIEW → built-in is sufficient, but `Intl.DateTimeFormat` formats, it doesn't construct. For `date` "2026-06-16"→ tz-midnight RFC3339, derive the offset via `Intl` (timeZoneName) or treat all-day as floating date-only; avoid naive `new Date(date)` (parses as UTC). No library if you encode offset correctly — verify DST boundary case.

3. **Module structure**: PASS → split `client.ts` (auth/pagination) + `mapping.ts` (pure GCal→event, unit-testable, no I/O) + `sync.ts` (orchestration + syncToken). Mapping purity is the real win; mocking Google in one all-in-one file is the pain you're avoiding.

Caveat: confirm incremental-sync 410 (invalid syncToken) triggers full-resync fallback — that's the top correctness risk, independent of all three points.

## Sonnet Response
- 적용 (point 1): `googleapis` 채택. OAuth token refresh / pagination / syncToken·410 의미론을 직접 구현하지 않음. self-hosted 단일 스크립트라 번들 크기 무관.
- 적용 (point 2): naive `new Date(dateStr)` 금지 (UTC로 파싱되어 tz 어긋남). all-day `date` 필드는 CAIRN_TIME_ZONE의 offset을 명시적으로 인코딩해 midnight RFC3339 생성. 날짜 라이브러리 미도입. DST 경계 케이스를 단위 테스트에 포함.
- 적용 (point 3): `client.ts`(auth/pagination) + `mapping.ts`(순수 GCal→event, I/O 없음, 단위 테스트 대상) + `sync.ts`(orchestration + syncToken) 3분리. mapping 순수성 확보가 핵심.
- 적용 (caveat): 410 (invalid syncToken) 수신 시 syncToken 폐기 후 full-resync fallback 경로를 구현하고 테스트. 최우선 정합성 리스크로 추적.
- 무시: 없음.
