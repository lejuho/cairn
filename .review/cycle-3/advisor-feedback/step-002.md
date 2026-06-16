---
step: "002"
type: "Completion check"
topic: "Cycle 3 GCal Inbound Sync 전체 완료"
---

## Query

Completion check: Cycle 3 GCal Inbound Sync, 회귀 우려 지점 2개

1. scripts/ TypeScript 컴파일/타입 검사 범위 외
2. SQLite raw ON CONFLICT 구문이 migration 선행 보장 필요

## Advisor Verdict

1. scripts/ typecheck 누락 — ACTION 필요. tsconfig.scripts.json 별도 추가 + typecheck/lint 확장 권장.
2. migration 선행 보장 — 충분. test와 gcal-sync.ts 양쪽 runMigrations 선행 확인.

## Applied

- tsconfig.scripts.json 추가 (noEmit, src+scripts include)
- server/package.json typecheck에 tsc -p tsconfig.scripts.json --noEmit 추가
- server/package.json lint에 scripts/ 추가

## Final Verification

- lint ✅
- typecheck (src + scripts) ✅
- test: 18 unit ✅
- test:integration: 42 tests (18 new GCal) ✅
- build ✅
- db:generate: "No schema changes" ✅
- git diff --check ✅
