# Agent Inbox

Cairn 이 사용자의 입력을 기다리지 않고, 관찰(세션·폰 알림·에이전트 대화)에서 질문을 만들어
에이전트가 대신 묻게 하는 층. macro-obs `events` 패턴(append-only 로그 + 에이전트 pull)에
**질문 상태 관리**와 **좁은 쓰기 경로**를 더한 구조다.

```
관찰 ──▶ observations (append-only, 원문)
  · Claude Code SessionEnd 훅  (claude_session: cwd, 첫/마지막 요청, 턴 수)
  · 폰 알림 (phone_notification, tailnet /ingest)
  · 에이전트 cairn_observe (agent)
        │
        ▼  observation-extractor (10분 주기, server 프로세스 내부)
  · 폰 알림 → LLM(Grok gateway) → event_candidate   (시각이 텍스트에 있을 때만)
  · 미매핑 작업 디렉터리 → thread_link 질문          (LLM 없음)
        │
기존 데이터 ──▶ /api/inbox 호출 시 materialize (멱등, dedupe_key)
  · 끝난 시간 지정 일정(3일 내, 종일 제외) → outcome_check
  · 7일 내 thread 마감 → deadline
  · due watcher → watcher_due
        │
        ▼
inbox_items (pending → answered / dismissed / expired, snooze)
  · Claude Code SessionStart 훅이 상위 3개를 세션 컨텍스트에 주입
  · MCP cairn_inbox / cairn_context_now 로 어느 에이전트든 조회
  · cairn_confirm 으로 답 기록 → 수락/거절 모두 남음 (학습 재료)
```

## API

| Method | Path | 비고 |
| --- | --- | --- |
| GET | `/api/inbox?cwd=&limit=&now=` | pending 질문, 우선순위 순. cwd 에 묶인 thread 는 +30 |
| POST | `/api/inbox/:id/answer` | `{decision: accept\|reject\|dismiss\|snooze, value?, note?, snoozeHours?, answeredBy?}` |
| GET | `/api/context/now?cwd=` | 24시간 내 일정 + 활성 thread + inbox 상위 5 |
| POST | `/api/thread-workspaces` | `{threadId, path}` 작업 디렉터리 → thread |
| POST | `/api/observations` | Bearer `CAIRN_INGEST_TOKEN` 필수 (미설정이면 loopback 만). JSON 또는 form |
| GET | `/api/observations?source=&limit=` | 최근 관찰 |

accept 효과: `outcome_check` → annotation + event.status, `event_candidate` → event 생성
(`source=manual, self_imposed=0`), `thread_link` → event.thread_id 또는 thread_workspaces.

## 안전장치

- 추론 결과는 항상 질문(pending)으로만 들어간다. 확정은 사용자 답으로만.
- OTP·인증번호 패턴 알림은 저장하지 않는다 (`services/observations.ts`).
- 폰 알림 원문은 14일 뒤 title/body 를 지운다. 추출 결과는 inbox 에 남는다.
- 폰 알림 추출은 Grok 프록시(외부)로 나간다.
- 훅은 `CLAUDE_CODE_ENTRYPOINT=cli` 이고 `CLAUDE_CODE_SESSION_ATTENDED=1` 일 때만 동작
  (`claude -p` 배치는 `sdk-cli`/`0` 이라 제외됨, 2026-10-14 확인).

## 배포 구성 (Pi)

- 토큰: `~/.config/cairn/ingest-token` (600) = env 파일 `CAIRN_INGEST_TOKEN`
  = MCP `CAIRN_API_BEARER_TOKEN` (Claude Code user scope, hermes config).
- 훅: `deploy/agent-hooks/cairn-session-{start,end}.sh`, `~/.claude/settings.json` 의
  SessionStart/SessionEnd 에 Orca 훅과 나란히 등록.
- 폰 수신: `sudo tailscale serve --bg --http=8791 --set-path=/ingest http://127.0.0.1:3100/api/observations`
  → `http://raspberrypi.tail5e2916.ts.net:8791/ingest` (tailnet 전용, 이 경로만 노출).
  IP 로 접속하면 404 — 반드시 MagicDNS 호스트명 사용. 해제: `sudo tailscale serve --http=8791 off`.
- 추출기 끄기: env `OBSERVATION_EXTRACTOR_ENABLED=0`.

## Android 설정 (MacroDroid)

1. Tailscale 앱: Android 설정 → 네트워크 → VPN → Tailscale → **상시 VPN** 켜기.
2. MacroDroid 매크로
   - 트리거: 알림 → 알림 수신 → 앱 선택 (카카오톡, 메시지, Gmail, 예약/티켓 앱 등. 단톡방이 많으면 좁게 시작)
   - 동작: 연결 → HTTP 요청
     - POST `http://raspberrypi.tail5e2916.ts.net:8791/ingest`
     - 헤더 `Authorization: Bearer <ingest-token>`
     - 본문 유형 `application/x-www-form-urlencoded`, 파라미터:
       `source=phone_notification`, `app=[앱 이름]`, `title=[알림 제목]`, `body=[알림 텍스트]`
       (값은 매직 텍스트 선택기로 넣는다)
   - 금융·인증 앱은 트리거 앱 목록에서 빼둔다 (서버 필터는 2차 방어).

## Cairn ↔ 에이전트 경계

- **Cairn = 기억과 계산**: 어느 에이전트가 물어도 같은 답이어야 하는 것. 일정/위치 타임라인, 이동시간
  (pinned > Google transit 추정, 도착 시각 기준), feasibility 판정, 충돌, 중복 제거(URL), 수락/거절 이력.
- **에이전트 = 감각과 대화**: 메일·X·Luma·대화에서 후보 찾기, 언제 물을지, 결과 전달, 실시간 경로 확인.
- 에이전트는 이동시간을 추정하지 않고 Cairn 판정을 전달한다.
- 네이버 경로 결과는 저장하지 않는다(cycle-77 원칙). 대신 판정이 `analysisRequests` 로
  "무엇을 언제 기준으로 확인해야 판단이 서는지"(route_check + naverUrl, origin_check)를 돌려주고,
  에이전트가 실시간으로 확인해 사용자에게 전한다. 사용자가 확인한 소요시간(분)만 `cairn_pin_route` 로 고정.
- 기본 출발지: params `default_origin` = 홍익대학교 서울캠퍼스 (직전 대면 일정 장소가 없을 때, 가정으로 명시).

| API | 용도 |
| --- | --- |
| POST `/api/feasibility/candidate` | 가정 판정 (저장 없음) |
| POST `/api/inbox/propose-event` | 구조화 후보 제안 → event_candidate + 판정, URL 기준 1회 |
| POST `/api/routes/pin` | 사용자 확인 소요시간 고정 (pinned_transit_facts, source=pinned_user) |

## 원격 MCP (ChatGPT·Grok 등)

- `mcp/src/remote.ts` — `cairn-mcp-remote.service`, `0.0.0.0:8792`, env `/home/pi/cairn-data/cairn-mcp-remote.env`.
- 기존 터널(n8n_tunnel)에 `cairn-mcp.lee-blog.me` → `http://172.19.0.1:8792`.
  Cloudflare Access 앱은 `cairn-mcp.lee-blog.me/oauth/authorize` 경로만 보호 (macro-obs 와 같은 방식),
  서버가 Access JWT(aud=`CF_ACCESS_AUD`, email=`OAUTH_OWNER_EMAIL`)를 직접 검증 → 설정이 빠지면 승인 불가(fail closed).
- OAuth 2.1 + PKCE + 동적 등록. 상태는 `/home/pi/cairn-data/mcp-oauth.json` (해시만 저장).
- 스코프: `cairn.read`(context_now, inbox, threads_list, check_feasibility), `cairn.confirm`(confirm, observe, propose_event, pin_route). 일정 CRUD 는 노출 안 함.
- 답·관찰의 `answeredBy`/`agent` 는 서버가 `remote:<클라이언트 이름>` 으로 덮어쓴다.
- 서버→클라이언트 SSE 스트림은 미지원 (POST 요청-응답만, GET /mcp = 405).
- 커넥터 URL: `https://cairn-mcp.lee-blog.me/mcp`. 연결 끊기: oauth.json 에서 해당 client/token 삭제 후 재시작.

## 다음 단계

- 세션·에이전트 관찰을 thread 에 붙이는 LLM 추론, 수락/거절 이력을 few-shot 으로 재사용.
