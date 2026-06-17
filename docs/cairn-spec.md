# CAIRN — 기능 명세서

개인 일정·의도 추적 시스템. "일정 관리"가 아니라 **내 의사표현(마음을 바꾸는 행위)의 비용을 정량화해 추적**하는 단일 사용자용 도구.

### 📋 문서 사용법

- **유저 스토리**: "누가, 무엇을, 왜 하는지" 한 줄 요약 (여기선 사용자=1인, 상대역=Cairn 시스템)
- **기능 요구사항(FR)**: 구현해야 할 기능 단위
- **데이터 요구사항**: DB에 뭐가 저장/참조되는지 (공통 스키마는 0장 참조)
- **엣지케이스**: 정상 흐름 외에 처리해야 할 상황
- **❓ 미정**: 디자인/기획 확정 필요

### 설계 불변 원칙 (전 기능 공통 제약)

모든 FR은 다음을 위반하면 안 된다.

1. **제안만, 결정은 사용자.** 모든 출력은 이유를 붙인 제안. 자동 결정 금지.
2. **기록은 pull이 아니라 push.** 사용자가 채우는 폼 전제 금지. Cairn가 먼저 묻고 사용자는 한 줄 답.
3. **모든 가치는 비용으로 통일.** "효용" 점수 신설 금지. 행동 비용 + 누락 비용.
4. **NOW까지 거리가 검사 강도를 켠다.** 먼 미래 느슨, 임박 엄격.
5. **여백은 침묵이 기본.** 임계 넘을 때만 표면화, dismiss 존중.
6. **추론(inferred)은 확정(hard)으로 위장 금지.** firmness 구분이 안전장치.

---

## 0. 🗄 공통 — 시스템 개요 & 데이터 모델

### 0.1 모듈 구성

| 모듈 | 역할 | 장 |
| --- | --- | --- |
| 입력·동기화 | GCal 유입 + 3-경로 입력 + push 주석 | 1 |
| 맥락 (Threads) | thread 생성·편집·관계, firmness | 2 |
| 오늘 (Today) | push가 채우는 표면 홈 | 3 |
| 결정 (Decision) | 충돌 해소 인터럽트 | 4 |
| 실현가능성 (Feasibility) | gap·체력 예산, 파라미터 | 5 |
| 인물 (People) | 관계 기억 + 취급 프로파일 | 6 |
| 거울 (Mirror) | flake·비용·체력 패턴 자기인식 | 7 |
| 여백 (Watchers) | 주기/외생 감시, cron | 8 |

### 0.2 데이터 모델 (공통 스키마)

SQLite 단일 파일. 4개 코어 + 5개 확장.

| 테이블 | 핵심 필드 | 비고 |
| --- | --- | --- |
| `threads` | id, name, kind, goal, deadline, status | 맥락. top-down 1차 객체 |
| `events` | thread_id, title, type, start, end, location, source, self_imposed, status, commitment, reversible, cancel_money/social/effort/window, refund_cutoff | source of truth |
| `annotations` | event_id, outcome, reason_tags(json), reason_text, energy_at_time, logged_at | "왜 옮겼나". 가치 90% |
| `tasks` | thread_id, title, est_minutes, due, context, status, optional | 시간 없는 할 일. 2분 룰 |
| `links` | from/to_id, kind, firmness, source | 노드 간 엣지 |
| `thread_links` | from/to_thread, kind, firmness | 타임라인 간 관계 |
| `people` | name, relation, preferred_windows, hard_constraints(json), lead_time, channel, sensitivities, total_meets, last_met | 관계 + 취급 프로파일 |
| `event_people` | event_id, person_id | N:M 태그 |
| `watchers` | category, label, kind, armed, rule(json), threshold, last_fired, snoozed_until | 여백. cron 구동 |
| `params` | key, value | 대시보드 물리상수 |

**공통 저장값**

Drizzle의 TypeScript 상수명은 대문자를 사용할 수 있지만 SQLite에는 아래
소문자 값만 저장한다.

- `events.status`: `planned` / `confirmed` / `done` / `cancelled` / `moved` / `late`
- `events.source`: `gcal` / `manual` / `cairn`
- `tasks.status`: `todo` / `doing` / `done` / `dropped`
- `threads.status`: `active` / `done` / `paused` / `dropped`
- `links.firmness`: `hard` / `soft` / `tentative` · `links.source`: `given` / `authored` / `inferred`
- `links.kind`: `blocks` / `requires` / `triggers` / `caused_by` / `follows`
- `thread_links.kind`: `contains` / `blocks` / `feeds` / `competes` / `shares`

### 0.3 동기화 방향 (확정) · 미정

**확정 — 입구를 출처로 분리:**

- **GCal을 거친 일정** (회사 미팅·받은 초대·내가 GCal/폰 기본 캘린더에서 직접 만든 일정) → GCal에 먼저 생김 → CAIRN가 읽어옴 (`source='gcal'`, `self_imposed=0`). 만든 사람이 아니라 GCal이 입구인지가 기준.
- **내가 만드는 것** (thread·작업·약속) → 앱에서 바로 SQLite 저장 (`source='cairn'`, `self_imposed=1`). GCal 안 거침.
- SQLite가 source of truth (GCal엔 firmness·비용·주석 담을 곳 없음).
- 이 분리로 "내보낸 걸 다시 인식"하는 루프·중복·태그 오염이 애초에 안 생김 (내 것은 처음부터 SQLite, 재유입 없음).
- **입구 = self_imposed**: GCal 유입=0(외부), 앱 생성=1(자기부과=flake 추적 대상). 입구가 곧 출처 판단.
- **GCal 내보내기(미러)는 선택**: "폰 기본 캘린더에서도 보고 싶다"일 때만 *일방 표시용 복사본*. 안 해도 완전 작동, 일방이라 루프 없음.

**❓ 미정:**

- [ ] 내보내기 미러 도입 여부·시점 (MVP는 유입만으로 충분)
- [ ] 미러 시 GCal 측 수정(시간 이동·삭제) 역반영 범위 — cairn_id 태그로 매칭, 시간·삭제만
- [x] 스택 — 확정: pnpm 모노레포 + React/Vite PWA + Raspberry Pi
  Fastify 서버 + 로컬 SQLite/Drizzle (10장)

---

## 1. 🔌 입력 · 동기화

### 1.1 유저 스토리

- **사용자**로서, GCal을 거친 일정은 직접 입력 없이 캘린더에서 자동으로 들어왔으면 한다
- **사용자**로서, 단발 할 일은 한 줄로 빠르게 넣고 싶다
- **사용자**로서, 일정이 끝난 뒤 "왜 옮겼는지"를 폼이 아니라 한 줄 답으로 남기고 싶다
- **사용자**로서, 스스로 기록하는 걸 어려워하므로 Cairn가 먼저 물어봐 주길 바란다

### 1.2 입력 경로 (3종)

| 경로 | 대상 | 입력 비용 |
| --- | --- | --- |
| 자동 유입 | GCal을 거친 일정 | 0 — GCal에서 당겨옴 (`source='gcal'`, `self_imposed=0`) |
| 한 줄 | 단발 이벤트(flat) | 낮음 — "내일 3시 치과" → 이벤트 1개. thread·의존관계 없음 |
| 자연어 생성 | 구조 있는 프로젝트/여행 | 중 — 문단 설명 → thread+다노드 초안. 2장 생성→편집 흐름 |

시간 배정은 별도 축이다. 한 줄 입력(②)과 자연어 생성(③)은 시간을 박아 즉시 배정될 수도 있고, `start=NULL`인 event 또는 `due`만 있는 미배치 task처럼 날짜 미정 상태로 들어올 수도 있다. 이 미정 상태는 네 번째 입력 경로가 아니라 ②·③의 "시간 비워둔 버전"이며, 나중에 사용자 요청이나 Today push surface를 통해 FR-SLOT(5-2장) 후보 슬롯 추천으로 배정된다.

### 1.3 Push 주석 흐름

```
Cairn → "어제 18시 X 약속 어떻게 됐어?"
사용자 → "옮김, 컨센서스 후유증으로 방전"  (한 줄)
LLM   → annotations INSERT (outcome='moved', reason_tags=['energy'],
         energy_at_time=2, reason_text='컨센서스 후유증으로 방전')
```

LLM 역할 = 추천기가 아니라 **비정형 한 줄 → 구조화** 변환기.

### 1.4 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-SYNC-01 | GCal 이벤트 유입 | GCal을 거친 이벤트를 `events`로 동기화 (`source='gcal'`, `self_imposed=0`) |
| FR-SYNC-02 | 한 줄 이벤트 생성 | 자연어 한 줄 → 단일 flat event 파싱·등록(thread 생성 없음) |
| FR-SYNC-03 | Push 질의 발송 | 종료/임박 이벤트에 대해 Cairn가 먼저 한 줄 질문 발송 |
| FR-SYNC-04 | 한 줄 답 → 주석 파싱 | 자유 서술을 `annotations`(outcome/tags/energy/text)로 구조화 |
| FR-SYNC-05 | 금전 비용 자동 수집 | 외부 약속·임박 시 Gmail 티켓/예약 메일에서 `cancel_money`·`refund_cutoff` 파싱 |
| FR-SYNC-06 | 2분 태스크 식별 | `est_minutes<=2 AND status='todo'` 쿼리 |
| FR-SYNC-07 | GCal 미러 내보내기 (선택) | 앱 생성 이벤트(`source='cairn'`) 중 시간 박힌 것을 GCal에 *표시용 복사본*. `cairn_id` 태그 심음. 일방, 재유입 안 함 |
| FR-SYNC-08 | 미러 수정 회수 (선택) | GCal에서 미러를 직접 옮김/삭제 시 `cairn_id` 매칭해 *시간·삭제만* SQLite 역반영 |

### 1.5 데이터 요구사항

- 쓰기: `events`, `tasks`, `annotations`
- **입구가 곧 출처**: GCal 유입 → `source='gcal', self_imposed=0` / 앱 생성 → `source='cairn', self_imposed=1`(flake 추적 대상)
- SQLite가 source of truth. GCal은 (선택적) 일방 미러
- 미러 이벤트에 `cairn_id` 태그(GCal extendedProperties)로 "내 사본"과 "남의 것" 구분 → 루프·중복 차단
- 금전 파싱 결과는 `events.cancel_money`, `refund_cutoff`에 저장
- annotations.reason_text 용도 확장: 마찰 사유 + 일정 회고(일기) 겸용. 한 줄 push 답을 마찰 구조화(outcome/energy)와 동시에 자유 서술로 보존 — 같은 입력이 두 역할.

### 1.6 엣지케이스

- **내 미러를 남의 것으로 오인** → `cairn_id` 태그 있으면 유입 스킵(내 사본), 없으면 외부로 유입. 루프 차단의 핵심
- GCal 미러를 사용자가 폰에서 직접 수정 → 시간·삭제만 회수, firmness·비용은 GCal에 없으니 회수 대상 아님
- 양쪽 동시 수정 충돌 → SQLite(master) 우선 기본, GCal 변경이 더 최신이면 확인
- GCal에서 삭제된 *GCal 유입* 이벤트 → 로컬 status를 CANCELLED로 둘지, 삭제할지 결정 필요
- LLM 파싱이 모호한 한 줄("그냥 좀 그랬어") → tags 비우고 text만 저장, energy 추정 안 함
- Push 질의에 무응답 → 일정 횟수 후 중단(보채지 않음)
- 같은 이벤트에 주석 여러 번 → 최신 우선 or 이력 누적

### 1.7 ❓ 미정 사항

- [ ] Push 질의 빈도 상한 (하루 몇 회까지 허용해야 알림 피로가 안 오나)
- [ ] Push 채널 (텔레그램 / 앱 푸시 / 둘 다)
- [ ] 금전 메일 파싱 실패 시 폴백 (수기 1회 질문 vs 공백 유지)

---

## 2. 🧵 맥락 (Threads)

### 2.1 유저 스토리

- **사용자**로서, 일정을 캘린더 날짜가 아니라 **맥락(프로젝트)별 일직선**으로 보고 싶다
- **사용자**로서, 구조 있는 프로젝트를 0에서 짜지 않고 **말로 설명하면 초안**을 받아 편집하고 싶다
- **사용자**로서, AI가 채운 것과 내가 명시한 것, 모르는 것을 **구분해서** 보고 싶다
- **사용자**로서, 큰 작업을 하위 타임라인으로 쪼개고 상위에서 진행률을 합산해 보고 싶다

### 2.2 화면 구성

#### 2.2.1 thread spine (`/threads/[id]`)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| 헤더 | thread명, 목표, 데드라인, 진행률 바 | 진행률 = done/active 카운트 |
| 미래 | 후보 슬롯(점수·이유) | NOW선 위. 예측 |
| NOW선 | 경계 | 위=예측, 아래=회고 |
| 과거 | 실행된 노드 (outcome 색·commitment 두께·energy·주석) | 클릭 시 주석 펼침 |
| 엣지 | 노드 간 연결 (실선=given / 점선=inferred+확인 / 흐림=tentative) | firmness 시각화 |
| 정산 | 완료 thread 시 "치른 비용 + 피한 누락 비용" | 0.2 `status='done'` |

#### 2.2.2 생성→편집 (`/threads/new`)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| 입력 | 자연어 설명 텍스트영역 | "파리 여행 6월 초, 여권·비자 필요…" |
| 초안 | thread + 노드 + 역산 사슬 (**전부 점선**) | 명시=authored, AI=inferred, 모름=공백 |
| 편집 | 인라인 수정 + "확인"(soft→hard) | 빈칸 채우기, 추론 확인 |

### 2.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-THR-01 | thread 조회 (맥락축) | `WHERE thread_id ORDER BY start`. 시간→맥락 축 전환 |
| FR-THR-02 | thread 생성 (자연어) | 설명 → thread+노드+역산 초안. 전부 `soft/inferred` |
| FR-THR-03 | 모름 공백 처리 | 추론 불가 필드는 환각 금지, "?(입력 필요)"로 비움 |
| FR-THR-04 | unknown 전파 | 미충족 처리기간이 하류 역산을 블로킹 |
| FR-THR-05 | firmness 승격 | "확인" 시 `soft→hard`(`authored`). 누락 비용 확실성 갱신 |
| FR-THR-06 | 노드 편집 | 인라인 값 수정 |
| FR-THR-07 | 진행률·정산 | done 카운트, 완료 시 비용 합·피한 누락 비용 |
| FR-THR-08 | 누락 노드 제안 | 같은 kind 과거 완료 thread 참고, 빠진 노드 `soft` 제안 (순서 복제 금지) |
| FR-THR-09 | thread 관계 등록 | `thread_links` 5종 (contains/blocks/feeds/competes/shares) |
| FR-THR-10 | contains 롤업 | 하위 thread 진행률·체력·누락 비용을 상위로 합산·드릴다운 |

### 2.4 데이터 요구사항

- `threads`, `events`, `tasks`, `links`, `thread_links`
- 생성 직후 모든 `links.firmness='soft'`, `source='inferred'`. 명시 입력만 `authored`
- `thread_links.kind='contains'`만 트리(롤업·cascade), 나머지는 그래프

### 2.5 엣지케이스

- 자연어가 엉뚱하게 파싱됨 → 전부 점선이라 무해, 사용자가 수정. 환각보다 공백
- 처리기간 모름 → 역산 불가 명시("비자 처리기간 채워야 계산됨")
- 상위 thread `cancelled` → contains 하위 cascade 처리
- competes/feeds 자동 추론 빗나감 → `soft` 제안만, 사용자 확인 전 효력 없음
- thread 관계 과잉 연결 → 엣지 희소성 경고 (대부분 쌍은 관계 없음이 정상)

### 2.6 ❓ 미정 사항

- [ ] kind 분류 세분도 (해커톤/RegTech/게임 단위? 누락 체크가 의미 있으려면 충분히 좁아야)
- [ ] 역산 처리기간 DB 기본값 제공 여부 (여권 ≈3주 등 상식값 프리셋 vs 항상 사용자 입력)
- [ ] thread 중첩 depth 상한

---

## 3. 🏠 오늘 (Today)

### 3.1 유저 스토리

- **사용자**로서, 아침에 화면 하나만 열면 **지금 중요한 게 다 모여** 있길 바란다
- **사용자**로서, 탭을 여러 개 외우고 뒤지는 인지 부담을 지고 싶지 않다

### 3.2 화면 구성 (`/today` — 홈, 기본 화면)

| 영역 | 구성요소 | 노출 조건 |
| --- | --- | --- |
| 체력 게이지 | 오늘 누적 / 예산 | 상시 |
| 결정 인터럽트 | 충돌 해소 카드 | 충돌 있을 때만 (4장) |
| 여백 말풍선 | watcher 알림 | 임계 넘은 watcher만 (8장) |
| 다음 일정 | 다음 약속 + gap 여유 | 상시 |
| 2분 태스크 | est_minutes≤2 체크리스트 | 해당 있을 때 |
| AI 조각 | needs-review 항목 | 검수 대기 있을 때 |

### 3.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-TODAY-01 | 표면 집계 | 충돌·watcher·다음gap·2분·needs-review를 우선순위로 끌어올림 |
| FR-TODAY-02 | 체력 미니 게이지 | 오늘 누적 load / `params.energy_budget`, 적자 예상 경고 |
| FR-TODAY-03 | 2분 태스크 체크 | 완료 토글 → `tasks.status='done'` |
| FR-TODAY-04 | AI 조각 검수 | needs-review 표시, 자동 done 금지(수동 승인 후 과거 안착) |
| FR-TODAY-05 | 인터럽트/말풍선 dismiss | 표면에서 해소·snooze, 심층 뷰와 상태 공유 |

### 3.4 데이터 요구사항

- 읽기 전용 집계 (events/tasks/watchers/충돌 계산). 자체 저장소 없음
- dismiss/snooze 상태는 각 원천(watcher.snoozed_until 등)에 기록, 표면은 그것을 반영

### 3.5 엣지케이스

- 표면에 끌어올릴 게 너무 많음 → 우선순위 컷, 나머지는 심층 뷰로
- 끌어올릴 게 하나도 없음 → "오늘은 조용함" 빈 상태 (침묵이 정상)

### 3.6 ❓ 미정 사항

- [ ] 표면 카드 우선순위 규칙 (결정 > 임박 watcher > gap > 2분 > needs-review 순 고정? 동적?)
- [ ] 표면에 동시 노출 카드 최대 개수

---

## 4. ⚖ 결정 (Decision)

### 4.1 유저 스토리

- **사용자**로서, 일정이 겹쳤을 때 **어느 쪽을 옮기는 게 싼지**를 이유와 함께 보고 싶다
- **사용자**로서, 비용을 하나의 점수로 뭉뚱그리지 말고 **분해해서** 보고 직접 정하고 싶다

### 4.2 화면 구성 (오늘 표면 내 인터럽트 — 독립 탭 아님)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| 충돌 헤더 | 겹침 구간, 양쪽 이벤트 | |
| 해소 옵션 | "A 옮기기 / B 옮기기" 각각 비용 분해 | money/social/effort/window 분리 |
| 추천 | 더 싼 쪽 표시 | 내부 weight는 순서용, 숫자 비노출 |
| 인물 제약 | hard 제약이 옵션 제거 ("금요일 불가") | 6장 연동 |
| 통보 초안 | 사람별 채널·리드타임·톤 | 6장 연동 |

### 4.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-DEC-01 | 충돌 탐지 | events 구간 겹침 (결정론) |
| FR-DEC-02 | 비용 분해 표시 | `cancel_*` 필드를 분리 칩으로. 스칼라 합산 금지 |
| FR-DEC-03 | 사회 비용 인물 보정 | people 빈도로 social 가중 (자주 봄=낮음) |
| FR-DEC-04 | 제약 기반 옵션 제거 | 인물 hard 제약 위반 옵션 차단 |
| FR-DEC-05 | NOW 거리 게이팅 | 먼 미래=겹침 표시만, 임박=해소 옵션 활성 |
| FR-DEC-06 | 해소 → 원장 기록 | 선택 시 의사표현 원장(7장)에 비용 로그 |
| FR-DEC-07 | 통보 초안 생성 | 영향받는 사람별 채널/리드타임/톤 (6장) |

### 4.4 데이터 요구사항

- 읽기: `events.cancel_*`, `people`, `links.firmness`
- 쓰기: 선택 결과 → 이벤트 status 갱신 + 원장 항목(개념상 annotations/별도 ledger view)

### 4.5 엣지케이스

- 양쪽 비용 우열 불명확 → 강제 추천 안 함, "네가 결정" 명시
- 양쪽 다 불가역/hard → 사용자에게 직접 에스컬레이션
- refund_cutoff 경과 → cancel_money 활성화로 비용 재계산

### 4.6 ❓ 미정 사항

- [ ] 내부 weight 산식 (순서 결정용, 비노출 — 그래도 튜닝 필요)
- [ ] 3개 이상 동시 충돌 시 UX

---

## 5. 🔋 실현가능성 (Feasibility)

### 5.1 유저 스토리

- **사용자**로서, 캘린더상 가능해도 **물리적으로 무리인 연결**(부산 2시→서울 5시)을 경고받고 싶다
- **사용자**로서, **하루 누적 체력**이 임계를 넘으면 알고 싶다
- **사용자**로서, 내 체력·버퍼·이동 마진을 **직접 조정**하고 싶다

### 5.2 화면 구성 (하루 단면 / 오늘 게이지)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| gap 검사 | 일정 사이 틈 vs 필요시간(이동·버퍼·overrun) | 여유 ±분, 색상 |
| 체력 적분 | 하루 누적 load 게이지 + 예산선 | 초과분=적자 |
| 파라미터 | 슬라이더 (예산·이동마진·버퍼·연속한계) | 실시간 재계산 |
| 모드 | 계획 / 실행 임박 | 검사 강도 토글 |

### 5.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-FEAS-01 | gap 실현가능성 | `available ≥ travel×margin×shock + buffer + overrun_risk` |
| FR-FEAS-02 | 체력 적분 | 하루 load running sum vs `energy_budget`, 적자 플래그 |
| FR-FEAS-03 | 파라미터 조정 | `params` 슬라이더 → 전체 실시간 재계산 |
| FR-FEAS-04 | NOW 거리 게이팅 | 계획=느슨/병목 허용, 임박=실측·경고 |
| FR-FEAS-05 | 외생 충격 재계산 | 교통/날씨 이벤트 시 travel 재계산 트리거 |
| FR-FEAS-06 | 연속 활동 한계 | 일과 span > `max_continuous` 경고 |
| FR-FEAS-07 | overrun 보정 | thread 히스토리(추정 배수)를 다음 gap required에 반영 |

### 5.4 데이터 요구사항

- 읽기: `events`(start/end/location/type), `params`, annotations(overrun 보정)
- `params` 키: energy_budget, travel_margin, deep_buffer, meet_buffer, max_continuous, deficit_mode
- 이동시간: 정적(시간표) v1 / 라이브 오라클 v2

### 5.5 엣지케이스

- 체력 소모 계수가 콜드스타트엔 추측 → 과대선전 금지, 관측으로 보정
- feasibility 위반 처리: 기본 **경고**(차단 아님), 차단은 사용자 옵트인
- 이동 불가 gap(음수 큼) → 마진 조정으로도 안 풀림, 빨강 유지(물리 위반)

### 5.6 ❓ 미정 사항

- [ ] 체력 load 계수 초기값 (type×duration 매핑)
- [ ] 라이브 이동시간 오라클 v2 도입 시점
- [ ] 회복(식사/수면 슬롯)의 체력 환원 모델

---

## 5-2. 날짜 미정 → 후보 날짜 추천 (Slot Suggestion)

이 시스템의 최초 출발 동기. "스스로 날짜 잡고 기억하기 어렵다"의 직접 해법. 메커니즘(슬롯 점수)은 5장에 이미 존재하므로, 여기서는 진입점·종합·출력만 명시한다.

### 유저 스토리

- 사용자로서, 아직 날짜를 안 정한 약속·작업에 대해 마찰 적은 후보 날짜를 먼저 제안받고 싶다
- 사용자로서, 추천 날짜가 왜 그 날인지(겹침 없음·체력 여유·통근 버퍼·관련자 선호) 이유와 함께 보고 싶다
- 사용자로서, 데드라인이 다가오는데 날짜를 안 잡은 게 있으면 Cairn이 먼저 짚어주길 바란다

### 진입점 (2종)

| 진입점 | 트리거 |
| --- | --- |
| 사용자 요청 | 미정 항목에서 "날짜 잡아줘" / 자연어로 "다음 주에 X 하고 싶어" |
| Cairn push surface | due 임박한 미정 task를 오늘 표면으로 끌어올림 (제안만, 강제 아님) |

### 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-SLOT-01 | 미정 항목 식별 | start IS NULL인 event 또는 due 있고 일정 미배치인 task |
| FR-SLOT-02 | 후보 슬롯 생성 | 가용 시간대 중 충돌 0(결정론)인 슬롯 후보군 추출 |
| FR-SLOT-03 | 슬롯 종합 점수 | feasibility 슬롯 점수(gap·체력·버퍼) × friction 보정(요일·타입·thread별 flake) × 인물 선호(관련자 있으면 preferred_windows) |
| FR-SLOT-04 | 이유 붙은 제안 | 후보 2~3개를 점수순 + 각 후보의 근거(겹침 없음·체력 여유·통근 버퍼·인물 선호)와 함께 |
| FR-SLOT-05 | NOW 거리 게이팅 | 먼 미래=느슨한 후보 허용, 임박=feasibility 엄격 적용 |
| FR-SLOT-06 | 미정 push surface | due 임박 미정 항목을 오늘 표면에 "날짜 잡을까?" 카드로 (제안, dismiss 가능) |
| FR-SLOT-07 | 선택 → 확정 | 후보 택1 시 event에 시간 배정(self_imposed=1), 필요 시 인물 통보 초안(6장) |
| FR-SLOT-08 | 근거 기여도 분해 | 각 후보 점수를 기여 렌즈별로 분해 표시 (feasibility / friction 보정 / 인물 선호가 각각 +/− 얼마). 단일 점수 뒤의 구성을 연다 |
| FR-SLOT-09 | 근거→조정 연결 | 근거 항목을 인터랙티브하게. 누르면 (a) 출처 근거 펼침(예: friction이면 과거 flake 사례), (b) 해당 조정 지점으로 연결(feasibility 파라미터 / friction 가중치 / 인물 선호 수정) |

### 데이터 요구사항

- 읽기: events/tasks(미정), params(feasibility), annotations(friction 보정), people(선호 시간)
- 쓰기: 선택 시 events.start/end 배정, status 갱신
- 신규 저장소 없음 — 기존 렌즈의 종합

### 엣지케이스

- [ ] 충돌 0 슬롯이 없음 → "마찰 적은 날이 없어. 무언가 옮겨야 함" + 충돌 해소(4장)로 연결
- [ ] 후보 간 점수 차 미미 → 강제 추천 안 함, 분해된 근거 나열 후 사용자 선택 (제1원칙)
- [ ] 콜드스타트(friction 데이터 빈약) → 점수는 feasibility만으로, 보정은 "표본 부족" 명시
- [ ] 관련자 hard 제약과 모든 후보가 충돌 → 해당 제약 표시 + 사용자에게 에스컬레이션

❓ 미정 사항

 - 후보 개수 기본값 (2 vs 3)
 - 가용 시간대 정의 (근무/수면 시간 등 params로 둘지)
 - push surface 임박 임계 (due 며칠 전부터 띄울지)

---

## 6. 👥 인물 (People)

### 6.1 유저 스토리

- **사용자**로서, 사람마다 **다르게** 다뤄(모두 똑같이 관리 X) 그 사람과 마찰을 안 내고 싶다
- **사용자**로서, "마지막에 언제 봤지"를 까먹으니 **관계 기억**을 surface 받고 싶다
- **사용자**로서, 일정 변경 시 **사람별 통보 방식**(채널·리드타임·톤)을 제안받고 싶다

### 6.2 화면 구성 (인물 디렉토리)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| 목록 | 인물 카드 (빈도·최근 만남) | 클릭 시 상세 |
| 관계 기억 | 함께한 일정 수, 시간 패턴 | events/annotations 파생 |
| 취급 프로파일 | preferred_windows / hard_constraints / lead_time / channel / sensitivities | 각 필드 firmness |
| 사회 비용 | 빈도 기반 (자주=낮음, 드묾=높음) | 의사표현 원장 연동 |

### 6.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-PPL-01 | 인물 태그 | 단독 아닌 이벤트에 `event_people` 태그 |
| FR-PPL-02 | 관계 통계 파생 | total_meets, last_met, 시간 패턴 추론 |
| FR-PPL-03 | 취급 프로파일 | 관측 가능 필드 추론(`soft`), hard 제약 임박 시 1회 확인(`hard`) |
| FR-PPL-04 | 사회 비용 보정 | 빈도→비용 산출 (적립 아님, 견고함 기술) |
| FR-PPL-05 | 제약→충돌 해소 | hard 제약이 결정 옵션 제거 (4장 연동) |
| FR-PPL-06 | 통보 초안 | 사람별 channel/lead_time/tone로 변경 통보 생성 |
| FR-PPL-07 | 인물 필터 | 특정 인물이 낀 이벤트 가로 강조 |

### 6.4 데이터 요구사항

- `people`, `event_people`. 통계는 events/annotations에서 파생·캐시
- hard_constraints는 json `[{text, firmness}]`

### 6.5 엣지케이스

- 프로파일이 자동으로 안 채워짐(관측 불가 제약) → 환각 금지, 임박 시 push 1회 수집
- 추론 제약을 hard로 표시 금지 → 사용자 확인 전 `soft`
- **윤리 위반 패턴**: "민감점 이용해 항상 그 사람에게 옮기기"는 조종 → 프로파일은 "폐 안 끼치는 법"으로만 프레이밍, "양보 받는 법" 기능 미구현

### 6.6 ❓ 미정 사항

- [ ] 사회 비용 빈도 구간 임계 (몇 회부터 "낮음"인가)
- [ ] 인물 통합/중복 처리 (같은 사람 다른 표기)
- [ ] 시간 패턴 추론 최소 표본 수

---

## 7. 🪞 거울 (Mirror)

### 7.1 유저 스토리

- **사용자**로서, 개별 일정이 아니라 **내 행동의 일관성**(나 요즘 어떻게 사나)을 보고 싶다
- **사용자**로서, 판단당하지 않고 **기술된 패턴**만 보고 스스로 고칠지 정하고 싶다

### 7.2 화면 구성 (`/mirror` — 심층 뷰)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| flake 패턴 | 요일·타입·thread별 미끄러짐 통계 | annotations 집계 |
| 의사표현 원장 | 변경 횟수, 비용0 vs 유비용, 누적 금전 | 행동 비용 추적 |
| 체력 경향 | 평균 피크, 적자 일수 | feasibility 누적 |

### 7.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-MIR-01 | flake 패턴 집계 | annotations를 thread·type·요일별 outcome으로 |
| FR-MIR-02 | 의사표현 원장 | 옮김/취소 비용을 분해 누적, 비용0 vs 유비용 |
| FR-MIR-03 | 체력 경향 | feasibility 피크 추이, 적자 일수 |
| FR-MIR-04 | 기술적 표현만 | 판단·지시 금지. "비추기만" (제1원칙) |
| FR-MIR-05 | 기능 필요도 추적 | 수동 처리 항목의 **빈도 × 놓침률 × 소스 안정성**을 집계해 "자동화 고려 시점" 제안. 외생 watcher뿐 아니라 모든 기능 자동화의 메타 신호 |
| FR-MIR-06 | 일기 뷰 (시간순 회고) | annotations를 시간 1차 축으로 읽는 뷰. thread(맥락)·거울(패턴)에 이어 시간순 렌즈. B 온도(따뜻·세리프) |
| FR-MIR-07 | 회고 질문 (선택·저빈도) | push가 가끔 경험 질문("오늘 기억에 남는 거?"). 하루 1회 이하, commitment 높거나 인물 낀 일정에만. 답=그 날 헤드라인 |
| FR-MIR-08 | 깊이 3층 | 자동(일정+push 한 줄, 부담 0) / 반자동(헤드라인 질문, 탭 1) / 수동(엔트리 열어 길게). 전부 선택, 강요 0 |

### 7.4 데이터 요구사항

- 읽기 전용 집계: `annotations`, `events.cancel_*`, feasibility 산출값
- 별도 저장 없음 (파생 뷰)

### 7.5 엣지케이스

- 데이터 빈약(콜드스타트) → 패턴 단정 금지, "표본 부족" 표시
- 부정적 패턴 표현 시 톤 → 비난 아닌 기술 (예: "월요일 자기부과 3/3 미끄러짐"까지, "게으르다" 금지)
- **놓침은 과소 기록됨** → 놓친 줄 모르거나 늦게 알아 기록 누락. 놓침률은 항상 과소 추정 → 빈도·소스 안정성을 보조 지표로 병행
- 기능 필요도 임계 → 가짜 정밀도 금지("8.5회 넘으면 자동화" X). "슬슬 고려할 만함" 제안이지 자동 트리거 아님
- 회고 질문 과다 → 심문이 됨. 빈도 절제(1.7)와 commitment 게이팅 필수. 치과 예약에 "어땠어?"는 노이즈
- 모든 일정에 회고 불필요 → 낮은 commitment·인물 없는 건 "있었다"로 충분
- AI 작업 로그와 일기 혼동 금지 → AI가 한 일은 활동 로그, 일기는 네 경험. 분리

### 7.6 ❓ 미정 사항

- [ ] 거울 갱신 주기 (주간 요약 vs 상시)
- [ ] 표본 부족 판정 임계
- [ ] 기능 필요도 임계 산식 (빈도·놓침·소스 안정성 가중)

---

## 7-1. 이력서 export (신규 — 별도 소절 또는 거울 확장)

이력서는 사전에 쓰지 않고 완결된 thread에서 사후 추출. annotation은 원재료, 저장 위치는 thread.

### threads 확장 필드:
```
resume_relevant  BOOL   -- 이력서 후보
star_situation   TEXT   -- nullable, 비면 goal/맥락에서 자동생성
star_action      TEXT   -- nullable, 비면 노드+annotations에서 자동생성
star_result      TEXT   -- nullable, 비면 정산에서 자동생성
skills_tags      JSON   -- ["Solidity","ZK",...]
```

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-CV-01 | STAR 초안 추출 | 완결 thread(goal+노드+annotations+정산)에서 LLM이 STAR 카드 초안 생성. "AI 초안→편집" |
| FR-CV-02 | export | STAR 카드 → 외부 포맷(Typst 이력서·Markdown·JSON). pcli 연동 가능 |
| FR-CV-03 | 사후 원칙 | 평소 입력에 이력서용 부담 추가 금지. 이미 쌓인 데이터에서만 추출 |

### 엣지케이스(이력서):

이력서 의식한 사전 과잉기록 → 금지(사전 폼 함정). export는 사후 추출만
STAR 자동생성이 과장·환각 → 초안일 뿐, 사용자 편집 전제. 정산의 실측 비용을 Result 근거로 (효용 과장 방지)
annotation에 이력서 스키마 박지 않음 → 입자 불일치(annotation=순간, 이력서=thread 집약). thread에 둠

---

## 8. ◇ 여백 (Watchers)

### 8.1 유저 스토리

- **사용자**로서, 평소 신경 안 쓰다 떠오르는 것(여행·쇼핑·행정)을 **비용 최적 시점에** 다시 받고 싶다
- **사용자**로서, 끊임없는 알림이 아니라 **임계 넘을 때만** 조용히 알려주길 바란다
- **사용자**로서, 서류 처리 리드타임을 **역산**해 "지금 신청해야 여유"를 알고 싶다

### 8.2 화면 구성 (`/watch` — 심층 뷰)

| 영역 | 구성요소 | 비고 |
| --- | --- | --- |
| 감시 목록 | watcher 카드 (대부분 침묵) | 점=조용, 말풍선=임계 |
| 결정론/외생 배지 | A(날짜함수) / B(웹감시 best-effort) | 신뢰도 구분 |
| 관심 스위치 | armed on/off | off=잠듦(임계 넘어도 침묵) |
| 역산 | 행정 리드타임 사슬 | "여권 4/13까지 신청" |

### 8.3 기능 요구사항

| ID | 기능 | 상세 |
| --- | --- | --- |
| FR-WAT-01 | watcher 등록 | category/label/kind/rule |
| FR-WAT-02 | 주기 평가 (cron) | 매일 1회 armed watcher 평가 |
| FR-WAT-03 | 결정론(A) 평가 | 날짜 함수 (예약 마지노선·만료·시즌). 외부 피드 0 |
| FR-WAT-04 | 외생(B) 평가 | 키워드 웹 감시. best-effort, 미포착 가능 명시 |
| FR-WAT-05 | 임계 표면화 | 넘은 것만 말풍선, 평소 침묵 |
| FR-WAT-06 | snooze | "나중에" → snoozed_until, 다시 안 보챔 |
| FR-WAT-07 | 관심 게이트 | armed=0이면 임계 넘어도 침묵 |
| FR-WAT-08 | 역방향 계획 | 리드타임 사슬 역산 → 최늦 안전 시작일 |
| FR-WAT-09 | 지출 타임라인 | 의류 시즌 사이클 등 별도 주기(events 비포함) |
| FR-WAT-10 | 외생(B) 수동 모드 | 자동 크롤링 전, 사용자가 외생 항목을 수동 watcher로 등록·로깅("청와대 개방 곧 끝남"). 빈도·놓침 신호 누적용 |
| FR-WAT-11 | B 수집 외부 분리 | 자동화 시 크롤링·스케줄·정제는 외부 파이프라인(n8n 등)에 두고, 에이전트는 *정제된 신호만* 호출. **LLM은 수집에 비포함**(토큰·안정성) |

### 8.4 데이터 요구사항

- `watchers` (rule json: cron / date-fn / keyword)
- 역산은 `links`(requires) 기계를 역방향 적용

### 8.5 엣지케이스

- B(외생) 미포착 → "완벽 포착 아님" 명시, 책임 안 짐
- snooze된 watcher 임계 재발 → 재알림 안 함 (snoozed_until까지)
- armed 토글 시 즉시 반영 (잠들면 표면에서도 사라짐)
- 실제 현재 가격(쇼핑) → 외부 피드(B), v1은 "구조적으로 싼 철"까지만

### 8.6 ❓ 미정 사항

- [ ] B(외생) 웹 감시 소스·빈도
- [ ] 결정론 watcher 자동 생성 범위 (FOMC 연간일정·정기 적립 등 프리셋?)
- [ ] 투자 공식/개인 타임라인 연결(triggers) UX

### 8.7 B(외생) 도입 단계

가치 80%는 A(결정론, 외부 데이터 0). B는 포착 가치가 불확실하므로 단계적으로.

- **v1**: B 자동화 없음. A만. 외생은 FR-WAT-10 **수동 watcher**로 직접 처리·로깅.
- **v1.5**: 거울(FR-MIR-05)이 임계 근접을 띄우면 — 풀 파이프라인 말고 *경량*. arm한 키워드 몇 개 주기 검색.
- **v2**: 실측으로 본전이 확인되면 n8n으로 소스별 크롤러·정제·중복제거. 검증 전 선구축 금지(안 쓸 파이프라인에 시간 낭비).

---

## 9. 🔒 전역 미정 · 경계 (cross-cutting)

### 9.1 범위 경계 (규율 추적기지 자문기 아님)

- O: 언제 일이 일어나는지, 하기로 한 행동을 했나/빼먹었나
- X: 무엇을 사고팔지, 어디로 갈지 — 시장 예측·매매 추천 절대 금지
- 투자 적용은 타이밍 사실(O) / 시장 예측(X). 공식 일정=외부 hard, 개인 행동=self_imposed

### 9.2 콜드스타트 정직성

- 위치/체력/누락 비용 추정은 히스토리 빈약 시 추측 → 초반 과대선전 금지

### 9.3 LLM 호출 지점 · 토큰 비용

기능의 ~80%는 **결정론**(산수·SQL·그래프 탐색)으로 토큰 0: 충돌 탐지, feasibility, friction 집계, 누락 비용, 결정론 watcher, 역산, 롤업·정산, 거울 집계.

LLM은 좁은 지점에만 — 전부 짧고·빈도 낮고·컨텍스트 작음:
- push 한 줄 → 주석 구조화 (FR-SYNC-04)
- 자연어 → thread 초안 생성 (FR-THR-02, 가끔)
- 충돌/슬롯의 "한 줄 이유" 서술
- Gmail 금전 파싱 (FR-SYNC-05)

**금지 패턴**: 표면 그릴 때마다 전체 상태를 LLM에 밀어넣기. 표면
집계도 결정론이고 LLM은 *변환·서술·초안 생성*에만 호출한다. 모든 LLM
호출은 Fastify 서버의 LLM 게이트웨이에서 기존 Grok OAuth-session
프록시로만 나간다. Cairn은 종량제 API key를 보유하지 않는다.

프록시는 별도 프로세스·포트에서 기존 구현 언어를 유지하고, Cairn 전용
OpenAI 호환 `/v1/chat/completions` 엔드포인트를 노출한다. 게이트웨이는
bounded retry, timeout, rate-limit queue를 담당한다. 프록시 장애 시 push
답변은 raw text를 먼저 저장하고 구조화 필드는 비워 재처리 가능하게 하며,
thread 초안 같은 생성 요청은 결과를 꾸며내지 않고 unavailable로 종료한다.
충돌·feasibility·watcher A·조회·집계는 이 장애와 무관하게 동작해야 한다.

로컬 기본 호출 주소는
`http://localhost:8000/v1/chat/completions`이다. 컨테이너 배치에서는
`LLM_PROXY_BASE_URL`에 프록시의 네트워크 주소를 주입하고 동일 경로를
사용한다. OpenAI 호환 요청·응답과 프록시 mock 모드(`mock: true`)는
동작 검증을 마쳤다. mock 모드는 개발·테스트에만 사용한다.

### 9.4 ❓ 전역 미정

- [ ] 인증/계정 (단일 사용자 로컬 vs 클라우드 동기)
- [ ] 데이터 백업·내보내기 (SQLite 파일 복사 기본)
- [ ] Grok 프록시의 retry·timeout·queue 수치와 운영 관측 기준
- [ ] Push 피로 측정·자동 빈도 조절 메커니즘

---

## 10. 🛠 기술 스택

### 10.1 구성

| 레이어 | 선택 | 비고 |
| --- | --- | --- |
| 모노레포 | **pnpm workspace** | `web` / `server` / `shared` |
| 프런트엔드 | **React + Vite + vite-plugin-pwa** | 모바일 70% — 설치형 셸·최근 데이터 캐시·푸시 |
| 백엔드 | **Fastify + Node.js LTS + TypeScript** | Raspberry Pi 상주. cron·sync·LLM gateway·push 담당 |
| 공유 계약 | **shared TypeScript types + runtime schemas** | API 요청·응답과 enum 계약 공유 |
| DB | **SQLite + better-sqlite3** | Raspberry Pi 로컬 파일이 source of truth |
| 스키마·migration | **Drizzle ORM + drizzle-kit** | 0.2 테이블과 소문자 상태값을 첫 migration으로 생성 |
| 테스트 | **Vitest** | SQLite 검증은 실제 임시 DB 통합 테스트 |
| LLM | **기존 Grok OAuth-session proxy** | 기본 `http://localhost:8000`, 컨테이너는 `LLM_PROXY_BASE_URL`; Cairn 전용 `/v1/chat/completions`; 종량제 API key 없음 |
| 외부 연동 | GCal API(유입), Gmail API(금전 파싱), 텔레그램(push 채널 후보) | |
| watcher B 수집 | n8n 등 외부 파이프라인 | v2, A 검증 후 (8.7) |

### 10.2 배치 함의

- **SQLite·서버가 Raspberry Pi에 상주** → PWA는 *클라이언트*,
  데이터·결정론 연산은 서버가 소유한다.
- **접근 경로**: 집 밖에서 폰 PWA가 Raspberry Pi에 닿아야 함 →
  고정 접속(터널/VPN/포트포워딩) 필요. ❓ 방식 미정.
- **오프라인**: PWA는 셸·최근 데이터 캐시로 읽기는 오프라인 가능, 쓰기는 서버 복귀 시 동기. ❓ 충돌 처리 정책.
- **LLM 장애 격리**: 서버의 gateway만 프록시를 의존한다. 결정론 기능은
  프록시 프로세스 중단·OAuth 만료·rate limit 중에도 정상 동작한다.
- **단일 사용자·단일 서버** → 인증은 가벼워도 됨(외부 노출 시 최소 보호 필요).

### 10.3 ❓ 미정 사항

- [ ] 집 밖 접속 방식 (Tailscale 등 VPN / Cloudflare Tunnel / 직접 포트포워딩)
- [ ] PWA 푸시 발송 경로 (웹푸시 vs 텔레그램 봇 — push 모델 채널과 통합)
- [ ] 오프라인 쓰기 후 서버 복귀 시 동기·충돌 정책
- [ ] Raspberry Pi 다운 시 폴백 (읽기 전용 캐시 유지 정도)
- [ ] Grok OAuth-session 만료 감지·재인증 운영 방식

---

### 한 줄 요약

4개 코어(events·annotations·links·tasks) + 5개 확장(reversibility·person·watcher·params·thread_links) 위에서 8개 모듈이 돈다. 모든 FR은 6개 불변 원칙(제안만·push·비용통일·NOW게이팅·여백침묵·firmness)을 위반하지 않는다.
