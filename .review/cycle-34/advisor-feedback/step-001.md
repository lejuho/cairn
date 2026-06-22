# Step 001 — Approach check: cycle-34 watcher daily push

Cycle: 34
Pass: 1
Files Changed: (planned) server/src/services/watcher-daily-push.ts, server/src/repositories/watchers.ts, server/src/jobs/watcher-daily-push.ts, server/src/index.ts, server/scripts/watcher-daily-push.ts, server/package.json, package.json

## Advisor Verdict
PASS

## Advisor Feedback
1. 복사 채택. watcher-deep-view.ts 선례와 일관. cross-reference 주석 필수. 공통 util 추출은 별도 cycle scope — 지금 하면 watchers.ts/deep-view 동시 수정으로 commit unit 비대.
2. 단일 `inArray` UPDATE로 충분. better-sqlite3 sync라 한 statement = 암묵 atomic. 명시 transaction 불필요. Drizzle `inArray` import 확인만.
3. 명시 `WATCHER_DAILY_PUSH_TZ` 신뢰 말고, 결정성 위해 의도 고정. Pi는 KST 고정이니 process.env.TZ 신뢰하되, 서비스 date 계산은 주입된 `now`/`date`로 테스트 가능하게 분리. 스케줄러만 local time 사용, 서비스는 순수 유지.

## Sonnet Response
- 적용 (1): parseRule/effectiveThreshold 복사 + cross-reference 주석
- 적용 (2): inArray UPDATE 단일 statement 사용
- 적용 (3): 서비스는 주입된 date/now 사용, 스케줄러만 process.env.TZ 기반 local time 계산
