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

## 다음 단계

- 원격 MCP 노출 (macro-obs `oauth.js` 패턴, 외부 에이전트는 inbox/confirm/observe 스코프만).
- 세션·에이전트 관찰을 thread 에 붙이는 LLM 추론, 수락/거절 이력을 few-shot 으로 재사용.
