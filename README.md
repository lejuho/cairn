# Cairn

Cairn은 Raspberry Pi에서 돌리는 single-user local-first PWA다.
프런트엔드는 React/Vite PWA, 백엔드는 Fastify, 데이터 원본은 로컬 SQLite 파일이다.

## 구성

- `web/`: React + Vite + PWA. 기본 개발 주소는 `http://localhost:5173`.
- `server/`: Fastify API, SQLite/Drizzle, Today 집계, GCal sync, LLM gateway, Telegram worker.
- `shared/`: 서버와 웹이 함께 쓰는 TypeScript 타입과 Zod runtime schema.
- `docs/codebase-map.md`: 구현 전 먼저 보는 코드 구조도.

로컬 개발 시 웹은 상대 경로 `/api`, `/health`를 호출한다. Vite dev proxy가 이 요청을
서버 기본 포트 `http://localhost:3100`으로 넘긴다.

## 요구 환경

- Node.js `>=22 <23`
- pnpm `10.9.0`
- Corepack 사용 권장

`pnpm` shim이 없으면 모든 명령을 `corepack pnpm ...` 형태로 실행한다.

## 처음 설치

```bash
corepack enable
corepack pnpm install
```

## 개발 서버 실행

```bash
corepack pnpm dev
```

실행 후:

- 웹: `http://localhost:5173`
- 서버: `http://localhost:3100`
- 헬스체크: `http://localhost:3100/health`

기본 서버 DB 파일은 서버 패키지 작업 디렉터리의 `cairn.sqlite3`다. 명시 경로를 쓰려면:

```bash
DB_PATH=/home/pi/cairn/cairn.sqlite3 corepack pnpm dev
```

## 빌드와 검증

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:integration
corepack pnpm verify
```

`corepack pnpm verify`는 lint, typecheck, unit test, SQLite integration test,
build를 순서대로 실행한다.

## DB 명령

```bash
corepack pnpm db:generate
corepack pnpm db:migrate
```

Drizzle 명령에서 DB 경로를 고정하려면 `CAIRN_DB_PATH`를 쓴다.

```bash
CAIRN_DB_PATH=/home/pi/cairn/cairn.sqlite3 corepack pnpm db:migrate
```

테스트는 실제 Pi DB를 건드리지 않고 임시 SQLite 파일을 사용해야 한다.

## Google Calendar one-shot sync

최초 OAuth 인증:

```bash
GCAL_CLIENT_ID=<id> \
GCAL_CLIENT_SECRET=<secret> \
corepack pnpm gcal:auth
```

수동 sync:

```bash
CAIRN_DB_PATH=/home/pi/cairn/cairn.sqlite3 \
GCAL_CLIENT_ID=<id> \
GCAL_CLIENT_SECRET=<secret> \
corepack pnpm gcal:sync
```

토큰은 기본적으로 `.cairn/` 아래에 저장된다. `.cairn/`은 gitignore 대상이다.
`CAIRN_TIME_ZONE` 기본값은 `Asia/Seoul`이다.

## LLM proxy

LLM 호출은 서버의 gateway를 통해서만 나간다.
기본 proxy base URL은 `http://localhost:8000`이고, 배포 환경에서는
`LLM_PROXY_BASE_URL`로 바꾼다.

proxy가 꺼져도 `/health`, `/api/today`, DB migration, deterministic logic은 계속 동작해야 한다.

## Telegram needs-review push

Telegram long polling worker는 env가 켜진 경우에만 서버 부팅 중 같이 시작한다.

```bash
TELEGRAM_POLL_ENABLED=1 \
TELEGRAM_BOT_TOKEN=<bot-token> \
TELEGRAM_CHAT_ID=<chat-id> \
DB_PATH=/home/pi/cairn/cairn.sqlite3 \
corepack pnpm --filter @cairn/server dev
```

Telegram env가 없거나 실패해도 `/health`, `/api/today`, annotation intake, GCal sync는
계속 동작해야 한다.

## 주요 화면과 API

- 웹 기본 화면: `/today`
- 헬스체크: `GET /health`
- Today API: `GET /api/today`
- 이벤트 생성: `POST /api/events`
- 태스크 생성: `POST /api/tasks`
- 태스크 상태 변경: `PATCH /api/tasks/:id/status`
- watcher 생성: `POST /api/watchers`
- watcher snooze: `PATCH /api/watchers/:id/snooze`
- annotation intake: `POST /api/events/:id/annotations`

## 프로덕션 배포 (cairn.lee-blog.me)

배포 구조: Cloudflare Access + Tunnel → Caddy(`:8080`) → Fastify(`127.0.0.1:3100`)

```bash
# 빌드
corepack pnpm build
corepack pnpm db:migrate

# 서버 재시작
sudo systemctl restart cairn-server
systemctl status cairn-server

# 스모크 체크
curl http://127.0.0.1:3100/health
curl http://localhost:8080/health
```

설정 파일 예시: `deploy/` 디렉터리 참조.
상세 가이드: [`docs/deployment-cloudflare-access.md`](docs/deployment-cloudflare-access.md)

## 작업 규칙

구현 전 넓은 검색이 필요하면 먼저 `docs/codebase-map.md`를 본다.
패키지, route, service, schema, migration, command, 외부 연동, 큰 UI surface가 바뀌면
같은 작업 안에서 `docs/codebase-map.md`도 갱신한다.
