# CAIRN — 설계 문서

개인 일정·의도 추적 시스템. "일정 관리"가 아니라 **내 의사표현(마음을 바꾸는 행위)의 비용을 정량화해 추적**하는 것이 핵심. 일정은 표면, 추적 대상은 그 위에서 일어나는 결정과 그 비용·일관성이다.

---

## 1. 설계 철학

**작은 구조화된 로그 위의 추론기.** 빅데이터 추천기가 아니다. 단일 사용자, 연 수백~수천 건. 통계 학습이 아니라 잘 정리된 작은 컨텍스트 + 몇 개의 규칙 + 그 위에서 LLM이 추론. 그래서 SQLite 파일 하나로 충분하고, 데이터 레이크·벡터DB·Postgres는 전부 과잉이다.

핵심 원칙 다섯:

1. **제안만, 결정은 사용자.** 모든 출력은 이유를 붙인 제안이다. 자동 결정은 한 번 틀리면 신뢰가 깨지고 시스템 전체가 버려진다. 이유가 보여야 규칙을 고칠 수 있다.
2. **기록은 pull이 아니라 push.** 사용자가 대시보드에 채우는 구조는 방치돼 죽는다. Cairn가 먼저 묻고("어제 그 약속 어떻게 됐어?"), 사용자는 한 줄 답하고, LLM이 그 한 줄을 구조로 파싱한다.
3. **모든 가치를 비용으로 통일.** "효용"이라는 측정 불가능한 척도를 새로 들이지 않는다. 행동의 비용(옮김/취소)과 비행동의 비용(누락)으로 표현. 효용은 음의 누락 비용일 뿐.
4. **NOW까지 거리가 검사 강도를 켠다.** 먼 미래엔 느슨(병목·야심 허용), 임박하면 엄격(실측·개입). 같은 일정이 시간만으로 판정이 뒤집힌다.
5. **여백 레이어는 침묵이 전부.** 감시 기능의 가치는 조용함에 있다. 기본 침묵, 임계 넘을 때만 표면화, dismiss 존중, 관심 꺼지면 잠듦.

---

## 2. 데이터 모델 (SQLite DDL)

새 기능이 들어올 때 새 저장소가 아니라 기존 필드의 확장으로 붙는다는 것이 일관성의 핵심.

```sql
-- ════════════════════════════════════════════════════
-- THREADS — 맥락. top-down 계획에선 1차 객체.
-- ════════════════════════════════════════════════════
CREATE TABLE threads (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  kind               TEXT,            -- project | official | personal | social | investment
  goal               TEXT,
  definition_of_done TEXT,
  deadline           TEXT,            -- ISO date
  status             TEXT DEFAULT 'active',  -- active | done | paused | dropped
  created_at         TEXT DEFAULT (datetime('now'))
);

-- ════════════════════════════════════════════════════
-- EVENTS — 시간이 박힌 것. source of truth.
--   양방향 공존: 외부 약속은 gcal에서 들어오고(emergent),
--   내 작업은 thread에서 짜서 gcal로 나간다(top-down).
-- ════════════════════════════════════════════════════
CREATE TABLE events (
  id            INTEGER PRIMARY KEY,
  thread_id     INTEGER REFERENCES threads(id),
  title         TEXT NOT NULL,
  type          TEXT,              -- meeting|deepwork|deadline|social|admin|official
  start         TEXT, "end" TEXT,  -- ISO datetime
  location      TEXT,
  source        TEXT,              -- gcal | manual | cairn
  self_imposed  INTEGER DEFAULT 0, -- 0=외부약속, 1=자기부과 (= flake 위험 대상)
  status        TEXT DEFAULT 'planned', -- planned|confirmed|done|cancelled|moved|late
  commitment    INTEGER DEFAULT 2, -- 1..3

  -- reversibility (의사표현 비용) — 분해해 저장, 절대 스칼라로 합산하지 않음
  reversible    INTEGER DEFAULT 1,
  cancel_money  INTEGER DEFAULT 0,
  cancel_social INTEGER DEFAULT 0, -- 0..3 (단, 실제값은 people 빈도로 보정됨)
  cancel_effort TEXT DEFAULT 'none', -- none|message|call|visit
  cancel_window TEXT,              -- "특정 시간만 연락 가능" 등 제약
  refund_cutoff TEXT,              -- 이 날짜 지나면 cancel_money 살아남

  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT
);

-- ════════════════════════════════════════════════════
-- ANNOTATIONS — "왜 옮겼나/취소했나". 가치의 90%.
--   tags=집계용(쿼리 가능), text=추론용(LLM이 읽음).
-- ════════════════════════════════════════════════════
CREATE TABLE annotations (
  id             INTEGER PRIMARY KEY,
  event_id       INTEGER REFERENCES events(id),
  outcome        TEXT,             -- done|cancelled|moved|late
  reason_tags    TEXT,             -- JSON: ["energy","conflict","commute","forgot","mood","external"]
  reason_text    TEXT,             -- 자유 서술 (한 줄 → LLM 파싱)
  energy_at_time INTEGER,          -- 1..5
  logged_at      TEXT DEFAULT (datetime('now'))
);

-- ════════════════════════════════════════════════════
-- TASKS — 시간 없는 할 일. 2분 룰은 est_minutes에 산다.
-- ════════════════════════════════════════════════════
CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER REFERENCES threads(id),
  title       TEXT NOT NULL,
  est_minutes INTEGER,            -- est_minutes<=2 AND status='todo' → "지금 해치워"
  due         TEXT,
  context     TEXT,               -- @computer, @phone ...
  status      TEXT DEFAULT 'todo', -- todo|doing|done|dropped
  optional    INTEGER DEFAULT 0,  -- 1=nice-to-have (누락 비용 낮음)
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ════════════════════════════════════════════════════
-- LINKS — 노드 사이 엣지. firmness가 핵심.
--   prospective: blocks|requires|triggers (계획 DAG, 미리 선언)
--   retrospective: caused_by|follows (회고하다 발견)
-- ════════════════════════════════════════════════════
CREATE TABLE links (
  id         INTEGER PRIMARY KEY,
  from_id    INTEGER, from_kind TEXT,  -- 'event' | 'task'
  to_id      INTEGER, to_kind   TEXT,
  kind       TEXT,                     -- blocks|requires|triggers|caused_by|follows
  firmness   TEXT DEFAULT 'soft',      -- hard | soft | tentative
  source     TEXT DEFAULT 'inferred',  -- given(조직) | authored(내가/확인) | inferred(AI추측)
  created_at TEXT DEFAULT (datetime('now'))
);
-- 규칙: source='inferred'는 절대 firmness='hard'로 표시 금지.
--       누락 비용은 떠받치는 엣지의 firmness를 상속한다(soft → "아마 높음").

-- ════════════════════════════════════════════════════
-- THREAD_LINKS — 타임라인 간 관계. links가 노드 간이라면 이건 thread 간.
--   "포함"은 계층(트리), 나머지는 횡단(그래프) — 섞지 않는다.
-- ════════════════════════════════════════════════════
CREATE TABLE thread_links (
  id          INTEGER PRIMARY KEY,
  from_thread INTEGER REFERENCES threads(id),
  to_thread   INTEGER REFERENCES threads(id),
  kind        TEXT,   -- contains | blocks | feeds | competes | shares
  firmness    TEXT DEFAULT 'soft',  -- hard | soft. competes/feeds는 추론 약함 → soft 기본
  created_at  TEXT DEFAULT (datetime('now'))
);
-- contains : A의 큰 작업이 하위 thread로 쪼개짐. 계층(트리). 진행률·체력·누락 비용 롤업.
-- blocks   : A 완료가 B 시작의 선행. 크로스-thread 임계경로.
-- feeds    : A 산출물/학습이 B에 재사용. 재사용 제안.
-- competes : 같은 자원(시간·예산·에너지) 경쟁. 자원 충돌 사전 경고 ← 킬러.
-- shares   : 같은 인물/맥락 공유, 인과 없음. 군집.
-- 규칙: contains만 트리(롤업·cascade). 나머지는 그래프(롤업 안 함).
--       엣지는 희소할수록 가치 — 대부분 thread 쌍은 '관계 없음'이 정상.

-- ════════════════════════════════════════════════════
-- PEOPLE — 관계 기억 + 취급 프로파일.
--   프레이밍: "폐 안 끼치는 법"(배려). "양보 받는 법"(조종) 아님.
-- ════════════════════════════════════════════════════
CREATE TABLE people (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  relation          TEXT,           -- family|team|friend|...
  -- handling profile (각 필드 firmness 가짐: 추론 soft / 확인 hard)
  preferred_windows TEXT,           -- "평일 저녁만"
  hard_constraints  TEXT,           -- JSON: [{text:"금요일 불가", firmness:"hard"}]
  lead_time         TEXT,           -- "최소 3일 전 통보"
  channel           TEXT,           -- "전화" | "문자(답 느림)"
  sensitivities     TEXT,           -- "당일 변경에 서운"
  -- 관계 통계 (annotations/events에서 파생, 캐시)
  total_meets       INTEGER DEFAULT 0,
  last_met          TEXT
);

CREATE TABLE event_people (
  event_id  INTEGER REFERENCES events(id),
  person_id INTEGER REFERENCES people(id),
  PRIMARY KEY (event_id, person_id)
);

-- ════════════════════════════════════════════════════
-- WATCHERS — 여백 레이어. 별도, cron 구동. events에 안 들어감.
--   타임라인에 "없는데 언젠가 떠올라야 하는 것".
-- ════════════════════════════════════════════════════
CREATE TABLE watchers (
  id            INTEGER PRIMARY KEY,
  category      TEXT,             -- travel|shopping|admin|investment
  label         TEXT,
  kind          TEXT,             -- 'A' 결정론(날짜함수) | 'B' 외생(웹감시, best-effort)
  armed         INTEGER DEFAULT 1,-- relevance gate. 0이면 잠듦(임계 넘어도 침묵)
  rule          TEXT,             -- JSON: cron | date-fn | keyword
  threshold     TEXT,
  last_fired    TEXT,
  snoozed_until TEXT,             -- "나중에" 존중
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ════════════════════════════════════════════════════
-- PARAMS — 대시보드. 학습이 아니라 사용자가 선언하는 물리상수.
-- ════════════════════════════════════════════════════
CREATE TABLE params (key TEXT PRIMARY KEY, value TEXT);
-- energy_budget=100, travel_margin=1.3, deep_buffer=45,
-- meet_buffer=15, max_continuous=10, deficit_mode='warn' ...
```

투자는 신설 0 — 공식 일정(FOMC·공모·실적)은 `events`에 `self_imposed=0` + `links` firmness `hard/given`(회사 미팅과 동일 모델), 개인 행동(정기 매수·일지·분석)은 `self_imposed=1`(1인 프로젝트 작업과 동일). 둘은 `links.kind='triggers'`로 연결(공식 이벤트 → 개인 행동). 정기적인 건 `watchers`(kind A)로.

---

## 3. 여덟 렌즈 ↔ 테이블 매핑

전부 같은 테이블 위의 다른 렌즈다. 새 저장소 없음.

| 렌즈 | 읽는 테이블 | 핵심 연산 |
|---|---|---|
| **맥락 thread** | events + annotations (`WHERE thread_id`) | 필터 + 시간순 정렬. 축을 시간→맥락으로 뒤집기 |
| **feasibility** | events + params (day 단면) | gap 검사 + 체력 running sum. 점이 아니라 *사이*와 *적분* |
| **friction (flake)** | annotations (집계) | thread·type·요일별 outcome 패턴 보정계수 |
| **의사표현 비용** | events.cancel_* + people | 분해 비용, 합산 금지. 빈도로 social 보정 |
| **행동↔누락 비용** | events.cancel_* + links(DAG) | 행동=cancel 필드, 누락=DAG 하류 + firmness 상속 |
| **정산 (완결)** | tasks/events status 카운트 | 치른 비용 합 + 피한 누락 비용 |
| **firmness + 인물** | links.firmness + people | 실선/점선/흐림. 제약이 옵션 제거 |
| **여백 watcher** | watchers (별도, cron) | 결정론 A / 외생 B. 침묵 기본 |
| **thread 관계** | thread_links | contains 롤업 · competes 자원 충돌 사전 경고 |

### 9번째 렌즈 — thread 간 관계가 켜는 것

`thread_links`의 각 `kind`는 *다른 기능*을 켠다. 누적의 보상은 분류가 행동으로 갈리는 데 있다.

- **contains → 롤업 + 드릴다운.** 상위 thread가 하위 진행률·체력·누락 비용의 가중 합을 표시("업무 A 67%" = 하위 셋의 롤업). 큰 프로젝트를 한 thread에 욱여넣지 않는다. 맥락 뷰가 중첩됨. 부모 취소 시 자식 cascade.
- **blocks → 크로스-thread 임계경로.** 단일 thread feasibility는 thread 안만 본다. blocks 엣지가 쌓이면 "A의 이 작업이 B·C 둘 다 막는다" — 누락 비용이 thread 경계를 넘어 전파. 최대 잠금해제 지점을 드러냄.
- **competes → 자원 충돌 사전 경고 (킬러).** 같은 시기 competes thread 둘이 활성화되면, 캘린더 충돌이 *나기 전에* "둘 다 6월 데드라인 → 시간·체력 부족" 경고. feasibility 체력 적분을 thread 레벨로 올린 것. "여러 thread가 동시에 무거워지는" 문제를 정확히 잡음.
- **feeds → 재사용 제안.** 두 층위. (1) *산출물* 재사용: "B 시작 — A의 x402 코드 재사용 가능"(코드 부활 Base→Solana 패턴). (2) *구조적 학습* 재사용: 같은 kind 과거 완료 thread에서 빌리되 — **순서·노드 분배는 베끼지 않는다**(n 작음, 표면 유사≠구조 동형, 무엇이 "잘된 과거"인지 효용 판단 불가). 빌리는 건 둘뿐: ① **누락 체크리스트** — "이 kind엔 늘 리허설 노드가 있었는데 이번 초안엔 빠짐"(카운트만, 효용 판단 없음, 틀려도 무해), ② **보정 계수 이전** — "네 딥워크는 추정 1.6배", "월요일 자기부과 3/3 flake"를 새 thread 추정·배치에 적용(너에 대한 통계, friction/feasibility 렌즈가 이미 가진 것). 구조를 베끼지 말고 *빠진 걸 묻고 네 상수를 빌린다*.
- **shares → 인물·맥락 군집.** "이 셋은 다 NinjaLabs 사람". 인물 레이어와 합치면 "특정 인물이 낀 thread 전부" 가로보기.

경계: contains/blocks는 명시 선언이 쉽지만 **competes/feeds는 추론이 약하다** → firmness `soft`로 AI 제안 후 확인. 가짜 경쟁 경고는 신뢰를 깬다. 그리고 엣지는 희소하게 — 다 엮으면 거미줄이 빽빽해 신호가 사라진다.

---

## 4. 계산 레이어 — 세 축 + 비용 이원성

세 축은 성질이 다르므로 절대 한 점수로 뭉개지 않는다:

- **충돌 (boolean, 협상 불가)** — events 구간 겹침. 결정론. 빅데이터 불필요.
- **실현가능성 (budget, 시간 가까울수록 조임)** — gap별 `available ≥ travel×margin×shock + buffer + overrun_risk`, 하루 체력 running sum vs `energy_budget`. 외생 충격(파업)이 라이브로 깰 수 있음.
- **마찰 (probability, 너에 대한 통계)** — annotations 집계 + 휴리스틱 + LLM 종합.

비용은 두 비대칭 항목으로 통일:

- **행동의 비용** = `events.cancel_*` (옮김/취소). people 빈도로 social 보정(자주 봄=견고=낮음, 드묾=취약=높음).
- **비행동의 비용** = `links` DAG 하류 추적. "이걸 빼면 무엇이 무너지나". firmness 상속(soft 엣지 위면 "아마 높음").

연산 책임 분리: 충돌 해소는 결정론, feasibility는 휴리스틱+params, 최종 제시·우선순위·"한 줄 이유"는 LLM. 조각화(작업 분해)는 스케줄러가 아니라 planner의 일 — spine은 planner 출력을 *소비*만.

---

## 5. Push 인터랙션 모델

기록을 의무가 아니라 반응으로:

```
Cairn → "어제 18시 X 약속 어떻게 됐어?"
You    → "옮김, 컨센서스 후유증으로 방전"   (텔레그램 한 줄)
LLM    → annotations INSERT (outcome='moved',
          reason_tags=['energy'], energy_at_time=2,
          reason_text='컨센서스 후유증으로 방전')
```

LLM의 역할은 추천기가 아니라 **비정형 한 줄 → 구조화** 변환기. 같은 패턴이 실행 레이어(Andon: AI 조각이 모호함에 막히면 멈추고 "사람 입력 필요" 노드 → 한 줄 답 → 재개)와 firmness 승격(soft 엣지 "확인?" → hard), 인물 hard 제약 1회 수집까지 동일하게 적용된다.

비용 자동 수집: `cancel_money`는 손입력 아니라 Gmail 티켓·예약 메일 파싱. 외부 약속만, 임박할 때만 1회 질문.

---

## 6. Watcher cron 구조

```
매일 1회 cron:
  for w in watchers where armed=1 and (snoozed_until is null or now > snoozed_until):
    if w.kind == 'A':              # 결정론 — 날짜 함수, 신뢰 가능
        crossed = eval_date_rule(w.rule)   # 예약 마지노선 D-n, 여권 만료, 시즌 사이클
    elif w.kind == 'B':            # 외생 — 웹/뉴스 감시, best-effort
        crossed = web_check(w.rule.keywords)  # 놓치는 것 있음. 보장 아님.
    if crossed and not recently_fired(w):
        surface_bubble(w); w.last_fired = now
```

행정 = 역방향 계획: 리드타임 사슬을 거꾸로 합산해 *가장 늦은 안전 시작일* 역산. "여권 4/13까지 신청해야 6/1 여행 전 여유". `links`(requires) 기계를 반대로 돌린 것.

가치 80%는 A(외부 피드 0, 운영 trivial). B는 얹는 것이고 완벽 포착을 약속하지 않는다.

---

## 7. 경계선 — 시스템 성격을 가르는 선

기능은 같아도 의도가 도구의 성격을 정한다. 흐려지면 좋은 도구가 나쁜 도구가 된다.

**범위 경계 (Cairn는 규율 추적기지 자문기가 아니다)**
- O: *언제* 일이 일어나는지, *하기로 한 행동*을 했나/빼먹었나. "FOMC 내일", "리밸런싱 3개월째 안 함".
- X: *무엇을* 사고팔지, 지금이 살 때인지. 시장 예측·매매 추천 절대 금지.
- 타이밍의 사실(캘린더 산수) vs 시장의 예측(아무도 못 함). 전자만.

**인물 경계 (배려지 조종이 아니다)**
- O: 그 사람의 실제 제약을 존중해 폐 안 끼치기. "어머니 금요일 불가니 그날 안 잡음".
- X: 그 사람의 민감점을 이용해 내 편의 챙기기. "무르니까 항상 이쪽으로 옮김".
- 관계는 적립 포인트가 아니다. 빈도→비용은 "쌓아둔 호감을 쓴다"가 아니라 "관계의 견고함을 기술"한 것.

**자동화 경계 (제시지 결정이 아니다)**
- 스케줄링은 부드럽게 실패(슬롯이 좀 안 좋을 뿐), AI 실행은 세게 실패(틀린 산출물). 같은 spine에 표시하되 AI 조각은 자동 done 금지 — NOW에서 `needs-review`로 멈춰 검수받음.
- feasibility 하드 블록 기본 금지(경고 + 이유). 누락 비용은 DAG 정확할 때만 참 → 제시용.

**콜드스타트 정직성**
- 위치 기반 추정, 체력 소모 계수, 누락 비용은 히스토리 빈약하면 추측이다. 초반 과대선전 금지. 관측으로 보정되게 둘 것.

---

## 8. 구축 순서

레이어를 하나씩 켠다. 융합된 비전을 한 번에 짓지 않는다. spine이 공유 표면, 거기 무얼 비추느냐만 단계적으로.

1. **v0 코어** — SQLite + threads/events/annotations/tasks. GCal 동기화(이벤트는 당겨오고 주석만 수기). 충돌=구간 겹침(결정론). 2분 룰 쿼리. Push 한 줄 기록.
2. **v1 추적** — friction 집계(flake 패턴), thread 뷰(맥락 spine + 진행률), 의사표현 비용(cancel_* 분해 + 원장).
3. **v1.5 예산** — feasibility(gap + 체력 적분 + params 슬라이더), 정적 이동시간(KTX 시간표).
4. **v2 구조** — links DAG + firmness, 행동↔누락 비용, top-down 계획(AI 초안 → 편집 → GCal 내보내기), 비동기 실행 레이어(Andon).
5. **v2.5 관계** — people 취급 프로파일, 제약 기반 충돌 해소, 인물별 통보.
6. **v3 여백** — watchers(A 먼저, B best-effort), 역방향 계획(행정), 지출 타임라인(쇼핑), 투자 공식/개인 타임라인 `triggers` 연결.
7. **LLM 인프라** — Raspberry Pi의 Fastify LLM gateway가 기존 Grok
   OAuth-session 프록시를 단일 창구로 사용한다. 프록시 장애 시 raw 입력은
   보존하고 생성은 우아하게 거절하며, 결정론 기능은 독립적으로 유지한다.

---

## 9. 뷰 아키텍처 — 2층 구조

뷰는 "데이터를 담는 그릇"(캘린더/타임라인/알림)으로 가르지 않는다. 그러면 충돌 해소·feasibility·정산·자기인식이 갈 곳이 없다. **사용자가 무엇을 하러 오는가(목적)**로 가른다. 그리고 사용자가 일정 관리·기억을 어려워하므로 — 탭 다섯 개를 외우게 하는 것 자체가 인지 부담이다. 그래서 평면 5탭이 아니라 **2층**으로 간다.

### 표면 (1개) — "오늘"

90%의 시간이 사는 홈. push가 *지금 중요한 것만* 여기로 끌어올린다. 사용자는 탭을 뒤지지 않는다. 표면에 모이는 것(우선순위 순):

1. **결정 인터럽트** — 충돌이 있을 때만 끼어드는 카드. 해소 옵션 + 비용 분해 + 인물 제약 + 추천. *탭이 아니다.* 알림은 "알려주는" 것, 결정은 "정하게 하는" 것 — 성격이 달라 표면에 직접 끼운다.
2. **여백 말풍선** — 임계 넘은 watcher만(여권 역산, 예약 마지노선). 나머지는 침묵.
3. **다음 일정 + gap feasibility** — 다음 약속과 그 틈의 여유.
4. **체력 게이지** — 오늘 누적 / 예산. 적자 예상 경고.
5. **2분 태스크** — `est_minutes<=2 AND status='todo'`.
6. **AI 조각 needs-review** — 자동 done 안 됨. 검수 후 과거로 안착.

캘린더(외부 약속 시간축 확인)는 독립 뷰가 아니라 이 표면의 일부로 흡수된다.

### 심층 (3개) — 의도적으로 파는 곳

| 뷰 | 목적 | 보여주는 것 |
|---|---|---|
| **맥락 (Threads)** | "이 프로젝트 어디까지?" | thread spine — 과거 노드 + 미래 후보 + 진행률 + 정산 |
| **거울 (Mirror)** | "나 요즘 어떻게 살지?" | flake 패턴 · 의사표현 원장 요약 · 체력 경향 |
| **여백 (Watch)** | "놓치는 거 없나?" | watcher 전체(침묵 기본). 표면과 상태 공유(snooze 등) |

**거울이 thesis다.** 개별 결정이 아니라 *너라는 사람의 일관성*을 비추는 유일한 뷰. "일정 관리"가 아니라 "의도 추적"이라는 이 프로젝트의 정체가 여기서만 드러난다. 단 — 전부 기술(description)이지 판단이 아니다. 거울은 비추기만 하고, 고칠지는 사용자가 정한다(제5원칙의 자기인식 레이어 적용).

### 입력 경로 — 무게에 맞게 셋

전부 직접 입력도, 전부 챗봇 생성도 아니다.

- **외부 약속** → GCal 자동 유입. 입력 0.
- **단발 작업** → 한 줄("내일 3시 치과") → 이벤트 하나.
- **구조 있는 프로젝트/여행** → 자연어 설명 → Cairn가 thread + DAG + 역산 초안 → 사용자 편집.

생성된 구조의 firmness 규칙(제2장 links와 일치):
- 생성 직후 **전부 `inferred/soft`**(점선). 명시한 것은 비교적 단단(authored), AI가 채운 것은 soft.
- **모르는 칸은 지어내지 않고 비워둔다**("?(입력 필요)"). 환각보다 공백이 정직.
- **unknown 전파**: 처리기간이 비면 역산이 막힌다 — 모르는 칸이 하류 전체를 블로킹.
- 사용자 편집 = 틀린 거 고치기 + 맞는 거 "확인"으로 굳히기(soft→hard). 0에서 쓰는 게 아니라 끄덕이는 것 → 부담 최소.
- **누락 노드 제안**: 생성기는 같은 `kind`의 과거 완료 thread를 `feeds`로 참고해, *늘 있었는데 이번에 빠진 노드*를 soft로 덧붙인다("해커톤엔 보통 리허설 있었음 — 확인?"). 순서·분배는 베끼지 않음(통째 템플릿은 효용 안 나옴). 카운트 기반이라 효용 판단 없음, 틀려도 무해. 단 n 작으니 강제 아닌 제안, kind가 충분히 좁아야(해커톤/RegTech/게임) 비교가 의미 있음.

판단: AI가 추정할지 비울지를 가린다. 일반 상식(여권 ≈3주)은 *추정 + 확인*, 케이스별 천차만별(비자 처리기간)은 *공백*.

---

### 한 줄 요약

같은 4개 테이블(events·annotations·links·tasks) + 5개 확장(reversibility·person·watcher·params·thread_links) 위에서 아홉 렌즈가 돈다. 빅데이터 추천기가 아니라 작은 구조화 로그 위의 추론기. 제안만 하고 결정은 사용자가, 기록은 push로, 가치는 비용으로 통일, 검사 강도는 NOW 거리로, 여백은 침묵으로, thread 관계는 희소하게.
