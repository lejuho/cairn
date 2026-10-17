import { requestCairnApi, type ApiMethod, type CairnApiClientConfig, type CairnApiRequest } from "./api.js";
import { isJsonObject, toJsonValue, ToolInputError, type JsonObject, type JsonValue } from "./json.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export const API_ROUTE_CATALOG: JsonValue[] = [
  { method: "GET", path: "/api/today", purpose: "Today surface, cards, feasibility, location contexts" },
  { method: "GET", path: "/api/items", purpose: "Event/task inventory" },
  { method: "GET", path: "/api/context/now", purpose: "Current context: upcoming events, active threads, top inbox" },
  { method: "GET", path: "/api/inbox", purpose: "Pending confirmation questions" },
  { method: "POST", path: "/api/inbox/:id/answer", purpose: "Answer an inbox question" },
  { method: "POST", path: "/api/observations", purpose: "Record a raw observation" },
  { method: "POST", path: "/api/thread-workspaces", purpose: "Map a work directory to a thread" },
  { method: "POST", path: "/api/feasibility/candidate", purpose: "Judge a hypothetical event (no write)" },
  { method: "POST", path: "/api/inbox/propose-event", purpose: "Propose a structured event candidate" },
  { method: "POST", path: "/api/routes/pin", purpose: "Pin a user-confirmed route duration" },
  { method: "POST", path: "/api/capture/flat-event", purpose: "Natural-language event capture" },
  { method: "POST", path: "/api/events", purpose: "Create scheduled event" },
  { method: "GET", path: "/api/events/:id", purpose: "Event detail" },
  { method: "PATCH", path: "/api/events/:id/status", purpose: "Update event status" },
  { method: "PATCH", path: "/api/events/:id/thread-node", purpose: "Edit event node title/type/location/mode" },
  { method: "POST", path: "/api/events/:id/geocode", purpose: "Geocode event location into cache" },
  { method: "GET", path: "/api/events/:id/slot-candidates", purpose: "Unscheduled-event time candidates" },
  { method: "PATCH", path: "/api/events/:id/schedule", purpose: "Apply event slot candidate" },
  { method: "PATCH", path: "/api/events/:id/schedule-prompt/dismiss", purpose: "Dismiss event schedule prompt for one Today date" },
  { method: "POST", path: "/api/events/:id/preparations", purpose: "Add event preparation item" },
  { method: "POST", path: "/api/events/:id/annotations", purpose: "Add event outcome/record annotation" },
  { method: "GET", path: "/api/events/:id/materials", purpose: "List event materials (slides/VOD/recording links)" },
  { method: "POST", path: "/api/events/:id/materials", purpose: "Attach or expect an event material" },
  { method: "GET", path: "/api/events/:id/capture-check", purpose: "Material capture checklist by event profile" },
  { method: "PATCH", path: "/api/materials/:id", purpose: "Update material status/url/expectedAt" },
  { method: "GET", path: "/api/events/:id/people", purpose: "List event people" },
  { method: "PUT", path: "/api/events/:id/people", purpose: "Replace event people" },
  { method: "POST", path: "/api/tasks", purpose: "Create task" },
  { method: "PATCH", path: "/api/tasks/:id/status", purpose: "Update task status" },
  { method: "PATCH", path: "/api/tasks/:id/thread-node", purpose: "Edit task title/estimate/due/context/optional" },
  { method: "GET", path: "/api/tasks/:id/slot-candidates", purpose: "Due-task time candidates" },
  { method: "POST", path: "/api/tasks/:id/schedule-block", purpose: "Apply task slot as scheduled block event" },
  { method: "PATCH", path: "/api/tasks/:id/schedule-prompt/dismiss", purpose: "Dismiss task schedule prompt for one Today date" },
  { method: "POST", path: "/api/threads", purpose: "Create thread" },
  { method: "GET", path: "/api/threads", purpose: "List threads" },
  { method: "GET", path: "/api/threads/:id", purpose: "Thread detail" },
  { method: "PATCH", path: "/api/threads/:id/status", purpose: "Update thread status" },
  { method: "POST", path: "/api/threads/:id/links", purpose: "Create thread link" },
  { method: "DELETE", path: "/api/threads/:id/links/:linkId", purpose: "Delete thread link" },
  { method: "PATCH", path: "/api/threads/:id/node-links/:linkId/confirm", purpose: "Confirm inferred node link" },
  { method: "PATCH", path: "/api/threads/:id/resume", purpose: "Edit resume/STAR fields" },
  { method: "GET", path: "/api/threads/:id/resume-export", purpose: "Export resume data" },
  { method: "POST", path: "/api/threads/draft", purpose: "Natural-language thread draft" },
  { method: "POST", path: "/api/threads/:id/star-draft", purpose: "Generate STAR draft" },
  { method: "GET", path: "/api/threads/:id/resource-focus", purpose: "Thread resource focus" },
  { method: "GET", path: "/api/watchers", purpose: "List watchers" },
  { method: "POST", path: "/api/watchers", purpose: "Create date-threshold watcher" },
  { method: "POST", path: "/api/watchers/manual-exogenous", purpose: "Create manual-exogenous watcher" },
  { method: "POST", path: "/api/watchers/reverse-plan", purpose: "Create reverse-plan watcher and tasks" },
  { method: "PATCH", path: "/api/watchers/:id/armed", purpose: "Arm/disarm watcher" },
  { method: "PATCH", path: "/api/watchers/:id/snooze", purpose: "Snooze watcher" },
  { method: "POST", path: "/api/watchers/:id/manual-log", purpose: "Log manual-exogenous watcher observation" },
  { method: "GET", path: "/api/people", purpose: "List people" },
  { method: "POST", path: "/api/people", purpose: "Create person" },
  { method: "GET", path: "/api/people/directory", purpose: "People directory stats" },
  { method: "GET", path: "/api/people/:id/detail", purpose: "Person detail" },
  { method: "PUT", path: "/api/people/:id/profile", purpose: "Replace person availability/profile" },
  { method: "PUT", path: "/api/people/:id/hard-constraints", purpose: "Replace person hard constraints" },
  { method: "GET", path: "/api/places/naver", purpose: "Naver place candidate search" },
  { method: "GET", path: "/api/maps/provider-smoke", purpose: "Map provider smoke status" },
  { method: "GET", path: "/api/providers/status", purpose: "Provider status badges" },
  { method: "GET", path: "/api/sync/gcal/status", purpose: "Google Calendar sync status" },
  { method: "POST", path: "/api/sync/gcal/run", purpose: "Run Google Calendar sync now" },
  { method: "PUT", path: "/api/transit-facts/pair", purpose: "Pin public-transit duration between two events" },
  { method: "GET", path: "/api/feasibility/day", purpose: "Day feasibility" },
  { method: "GET", path: "/api/feasibility/params", purpose: "Feasibility parameters" },
  { method: "PUT", path: "/api/feasibility/params", purpose: "Update feasibility parameters" },
  { method: "POST", path: "/api/feasibility/day/preview", purpose: "Preview feasibility with parameter overrides" },
  { method: "GET", path: "/api/decisions/conflicts", purpose: "Conflict decisions" },
  { method: "POST", path: "/api/decisions/conflicts/resolve", purpose: "Resolve conflict" },
  { method: "GET", path: "/api/resources", purpose: "List resources" },
  { method: "POST", path: "/api/resources", purpose: "Create resource" },
  { method: "POST", path: "/api/resources/:id/links", purpose: "Create resource link" },
  { method: "GET", path: "/api/resources/promotion-suggestions", purpose: "Resource promotion suggestions" },
  { method: "POST", path: "/api/resources/promotion-suggestions/approve", purpose: "Approve resource promotion" },
  { method: "GET", path: "/api/relations/ego", purpose: "Resource/person ego graph" },
  { method: "GET", path: "/api/mirror/ledger", purpose: "Mirror ledger" },
  { method: "GET", path: "/api/mirror/patterns", purpose: "Mirror patterns" },
  { method: "GET", path: "/api/mirror/energy-trends", purpose: "Mirror energy trends" },
  { method: "GET", path: "/api/mirror/transition-friction", purpose: "Mirror transition friction" },
  { method: "GET", path: "/api/mirror/automation-needs", purpose: "Mirror automation needs" },
  { method: "GET", path: "/api/mirror/diary", purpose: "Mirror diary" }
];

// 두 서버(로컬 stdio·원격)의 instructions 끝에 붙는 응답 형식 안내.
export const RESPONSE_FORMAT_NOTE =
  " Response format: every tool returns {ok, status, statusText, data} where data is the Cairn server body {ok, data} — the \"반환:\" at the end of each tool description is the shape of that inner data.data. " +
  "On failure isError is true and data.error is {code, message} (e.g. VALIDATION_ERROR lists the bad field); fix the arguments instead of retrying unchanged.";

const EMPTY_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false
};

export const TOOLS: McpTool[] = [
  {
    name: "cairn_context_now",
    description: "지금의 맥락: 진행 중/24시간 내 일정, 활성 thread(현재 작업 디렉터리에 묶인 것 우선), 확인 대기 질문 상위 5개. 사용자가 '뭐부터 하지', '오늘 어때' 같은 걸 물으면 먼저 호출. 반환: {now, cwd, upcoming:[{id, title, start, end, location, threadId, status, ongoing}], activeThreads:[{id, name, goal, deadline, matchesWorkspace}], inbox:{items:[cairn_inbox 항목], pendingTotal}}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string", description: "현재 작업 디렉터리 (있으면 관련 thread 우선)" },
        now: { type: "string", description: "RFC3339 timestamp, 기본 현재" }
      }
    }
  },
  {
    name: "cairn_inbox",
    description: "사용자에게 확인할 질문 목록(우선순위 순). 대화 흐름이 끊기지 않는 시점에 1~2개만 자연스럽게 물어보고, 답을 받으면 cairn_confirm 으로 기록. 각 항목의 answerHint 를 따를 것. 반환: {items:[{id, kind, prompt, priority, relevance, threadId, threadName, subject:{type, id}, payload, evidence, createdAt, answerHint}], pendingTotal}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 50 }
      }
    }
  },
  {
    name: "cairn_confirm",
    description: "inbox 질문에 대한 사용자의 답을 기록. 사용자가 실제로 답한 것만 기록하고 추측으로 accept 하지 말 것. decision: accept|reject|dismiss|snooze. 반환: {id, status, effect(accept로 만들어진 것 | null)}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "decision"],
      properties: {
        id: { type: "number" },
        decision: { type: "string", enum: ["accept", "reject", "dismiss", "snooze"] },
        value: { type: "object", additionalProperties: true, description: "outcome_check: {outcome}, event_candidate: {title,start,end,location}, thread_link: {threadId}" },
        note: { type: "string", description: "사용자가 한 말 그대로 한 줄" },
        snoozeHours: { type: "number", minimum: 1 },
        answeredBy: { type: "string", description: "답을 받은 에이전트 이름 (예: claude-code, chatgpt)" }
      }
    }
  },
  {
    name: "cairn_observe",
    description: "대화 중 드러난 사실/결정/약속을 관찰로 기록 (추론 재료). 확정 일정이 아니라 원문 메모. 예: '다음 주 화요일 BAY 운영진 회의 잡힘'. 반환: {stored:true, id} 또는 {stored:false, reason:\"duplicate\"|\"filtered\"}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["body"],
      properties: {
        body: { type: "string" },
        title: { type: "string" },
        cwd: { type: "string" },
        agent: { type: "string", description: "기록한 에이전트 이름" }
      }
    }
  },
  {
    name: "cairn_check_feasibility",
    description: "그 시간에 그 장소(또는 온라인) 일정에 참여할 수 있는지 Cairn 이 판정 (일정 저장 안 함). 날짜가 멀수록 느슨하게(horizon: imminent ≤7일 / planning ≤60일 / distant), 동행자 조건·연락 기한, 근처 프로젝트 마감, 그날 부하, 종일 일정도 본다. 직전/직후 일정과 장소, 이동시간(고정값 > Google 대중교통 추정), 출발해야 할 시각, 겹침을 보고 가능/빠듯/어려움/확인 필요를 돌려준다. 이동시간을 직접 추정하지 말고 이 결과를 전달할 것. analysisRequests 는 판단 전에 확인해야 할 것(경로 확인, 출발지 확인)이며, route_check 는 naverUrl 로 실제 경로를 확인해 사용자에게 안내. 반환: {verdict, verdictKo, horizon, daysAhead, reasons[], risks:[{type, text}], people[], assumptions[], conflicts[], previous, next, legs:[{from:{label, source}, to, arriveBy, departBy, minutes, basis, naverUrl, slackMinutes}], analysisRequests:[{kind, priority, reason}]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["start"],
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "RFC3339 (+09:00)" },
        end: { type: "string", description: "RFC3339, 없으면 1시간" },
        location: { type: "string", description: "오프라인 장소 (예: 코엑스, 강남역 2번출구)" },
        online: { type: "boolean" },
        people: { type: "array", items: { type: "string" }, description: "같이 하는 사람 이름 (Cairn people, 부분 일치)" },
        kind: { type: "string", enum: ["meeting", "trip", "event", "other"] },
        abroad: { type: "boolean", description: "해외 여행/행사" }
      }
    }
  },
  {
    name: "cairn_propose_event",
    description: "메일·X·Luma·대화에서 찾은 일정을 구조화해서 Cairn 에 후보로 제안. 판정이 함께 돌아오고, 같은 URL 은 한 번만 질문으로 만든다(alreadyKnown=true 면 이미 물어본 것이니 다시 묻지 말 것). 사용자가 '넣어줘'라고 하면 돌아온 inboxId 로 cairn_confirm(accept). 반환: {inboxId, alreadyKnown, status, feasibility(cairn_check_feasibility 반환과 같음)}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "start"],
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "RFC3339 (+09:00)" },
        end: { type: "string" },
        location: { type: "string" },
        online: { type: "boolean" },
        people: { type: "array", items: { type: "string" }, description: "같이 하는 사람 이름 (Cairn people, 부분 일치)" },
        kind: { type: "string", enum: ["meeting", "trip", "event", "other"] },
        abroad: { type: "boolean", description: "해외 여행/행사" },
        url: { type: "string", description: "행사/메일 원문 링크 (중복 판별 기준)" },
        origin: { type: "string", description: "gmail | x | luma | conversation 등" },
        note: { type: "string" }
      }
    }
  },
  {
    name: "cairn_pin_route",
    description: "사용자가 확인한 구간 소요시간(분)을 고정. 이후 판정에서 Google 추정보다 우선한다. 사용자가 시간을 직접 말했거나 확인해 준 경우에만 호출하고, 네이버 경로의 상세 단계는 넣지 말 것 (note 는 '2호선 한 번' 정도의 짧은 메모). 반환: {id, from, to, minutes}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["from", "to", "minutes"],
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        minutes: { type: "number", minimum: 1, maximum: 600 },
        note: { type: "string" }
      }
    }
  },
  {
    name: "cairn_plan_prep",
    description: "여행·행사 준비 사슬을 등록. 각 준비의 소요 일수를 넘기면 Cairn 이 마지노선을 역산해 할 일과 알림(watcher)으로 만든다. 요건·소요 일수는 공식 출처로 확인한 것이나 사용자가 말한 것만 넣을 것. 반환: {watcher, tasks:[{id, title, status, due}](단계별 할 일), targetTask, links[], reversePlan}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["label", "targetDate", "steps"],
      properties: {
        label: { type: "string", description: "예: 파리 여행 준비" },
        targetDate: { type: "string", description: "YYYY-MM-DD (출발일 등)" },
        targetLabel: { type: "string" },
        safetyDays: { type: "number", minimum: 0, maximum: 30 },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          description: "실행 순서대로. leadDays = 이 단계에 걸리는 일수",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "leadDays"],
            properties: { label: { type: "string" }, leadDays: { type: "number", minimum: 0, maximum: 365 } }
          }
        }
      }
    }
  },
  {
    name: "cairn_event_capture_check",
    description: "일정 성격(강연·강의·회의·해커톤)에 따라 확보할 자료 체크리스트와 이미 붙은 자료를 돌려준다. covered=null 항목만 공식 출처에서 확인해 cairn_material_attach 로 기록할 것. 반환: {eventId, profile, items:[{kind, question, covered(null이면 미확인)}], instruction, materials:[자료]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "number", description: "event id" } }
    }
  },
  {
    name: "cairn_material_attach",
    description: "일정에 자료(발표자료·다시보기·녹음·메모·사진·링크) 포인터를 붙인다. 이미 있으면 status=available + url(또는 note). 공개 예정이면 status=expected + expectedAt(다시 확인할 시점) + sourceUrl(공지 출처) — 시점이 되면 Cairn 이 material_due 질문을 띄운다. 공개 여부·시점은 공식 출처나 사용자 말만 근거로, 본문은 저장하지 말 것. 반환: {material:{id, eventId, kind, status, label, url, expectedAt, sourceUrl, note, addedBy, missingReason, createdAt, updatedAt}}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind"],
      properties: {
        id: { type: "number", description: "event id" },
        kind: { type: "string", enum: ["slides", "video", "recording", "notes", "photo", "link", "file"] },
        status: { type: "string", enum: ["available", "expected", "missing"], description: "기본 available" },
        label: { type: "string", description: "세션명 등 (하루 행사 안의 세션 구분)" },
        url: { type: "string" },
        expectedAt: { type: "string", description: "ISO datetime with offset" },
        sourceUrl: { type: "string" },
        note: { type: "string" },
        addedBy: { type: "string" }
      }
    }
  },
  {
    name: "cairn_material_update",
    description: "자료 상태 갱신. 공개됐으면 status=available + url, 확인 시점을 미루면 expectedAt, 공개 안 함이 확인되면 status=missing. 반환: {material} (cairn_material_attach와 같은 형태).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "number", description: "material id" },
        status: { type: "string", enum: ["available", "expected", "missing"] },
        label: { type: ["string", "null"] },
        url: { type: ["string", "null"] },
        expectedAt: { type: ["string", "null"] },
        sourceUrl: { type: ["string", "null"] },
        note: { type: ["string", "null"] }
      }
    }
  },
  {
    name: "cairn_thread_workspace",
    description: "작업 디렉터리를 thread 에 묶는다. 이후 그 디렉터리의 세션에서 해당 thread 질문이 우선 노출된다. 반환: {threadId, path}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "path"],
      properties: { threadId: { type: "number" }, path: { type: "string" } }
    }
  },
  {
    name: "cairn_api_request",
    description: "Call any Cairn HTTP endpoint on the configured Cairn API base URL. Path is limited to /api/* or /health. 반환: 해당 경로의 서버 응답 본문 그대로.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["method", "path"],
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PATCH", "PUT", "DELETE"] },
        path: { type: "string", description: "Example: /api/today" },
        query: { type: "object", additionalProperties: true },
        body: { description: "JSON request body for POST/PATCH/PUT" },
        timeoutMs: { type: "number", minimum: 1000, maximum: 60000 }
      }
    }
  },
  {
    name: "cairn_route_catalog",
    description: "List Cairn API routes exposed through cairn_api_request. 반환: 이 도구만 봉투 없이 {ok, data:{routes:[{method, path, purpose}]}}.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_today_get",
    description: "Read the Today surface. 반환: {date, now, state, nextEvent, conflicts[], dayEvents[], cards[], unscheduledEvents[], dueTaskSchedulePrompts[], watcherBubbles[], needsReviewEvents[], twoMinuteTasks[], feasibility:{params, energy:{loadUnits, budgetUnits, remainingUnits, deficit}, gaps[], sequenceEnergy, sequenceOrder, …}, locationContexts[]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["date", "now"],
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        now: { type: "string", description: "RFC3339 timestamp" },
        domain: { type: "string", enum: ["personal", "work", "all"] }
      }
    }
  },
  {
    name: "cairn_items_list",
    description: "List event/task inventory. 반환: {scope, events:[{id, threadId, title, type, start, end, location, mode, source, status, …}], tasks:[{id, threadId, title, estMinutes, due, context, optional, status, …}]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        scope: { type: "string", enum: ["active", "all"] },
        limit: { type: "number", minimum: 1, maximum: 200 }
      }
    }
  },
  {
    name: "cairn_event_create",
    description: "Create a scheduled Cairn event. 반환: 생성된 일정 {id, threadId, title, type, start, end, location, mode, source, status, …}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "start", "end"],
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "RFC3339 timestamp with offset" },
        end: { type: "string", description: "RFC3339 timestamp with offset" },
        type: { type: "string" },
        location: { type: "string" },
        mode: { type: "string", enum: ["in_person", "remote", "async"] },
        threadId: { type: "number" },
        personIds: { type: "array", items: { type: "number" } }
      }
    }
  },
  {
    name: "cairn_event_update_node",
    description: "Edit event node fields: title, type, location, mode. 반환: {event}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "number" },
        title: { type: "string" },
        type: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        mode: { type: ["string", "null"], enum: ["in_person", "remote", "async", null] }
      }
    }
  },
  {
    name: "cairn_event_status",
    description: "Update event status. 반환: {event}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status"],
      properties: {
        id: { type: "number" },
        status: { type: "string", enum: ["planned", "confirmed", "done", "cancelled", "moved", "late"] }
      }
    }
  },
  {
    name: "cairn_event_geocode",
    description: "Geocode an event's authored location and update the geocode cache. 반환: {eventId, provider, locationText, normalizedLocation, cacheStatus, status, latitude, longitude, …}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "number" } }
    }
  },
  {
    name: "cairn_event_slot_candidates",
    description: "Preview schedule candidates for an unscheduled event. 반환: {event, candidates:[{start, end, score, rank, scoreLabel, reasons[], reasonCodes[], contributions[]}]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "date", "now"],
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        now: { type: "string" },
        days: { type: "number" }
      }
    }
  },
  {
    name: "cairn_event_schedule",
    description: "Apply one event slot candidate. 반환: {event}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "date", "now", "start", "end"],
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        now: { type: "string" },
        days: { type: "number" },
        start: { type: "string" },
        end: { type: "string" }
      }
    }
  },
  {
    name: "cairn_task_create",
    description: "Create a Cairn task. 반환: 생성된 할 일 {id, threadId, title, estMinutes, due, context, optional, status, …}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string" },
        estMinutes: { type: "number" },
        due: { type: "string" },
        context: { type: "string" },
        threadId: { type: "number" },
        optional: { type: "boolean" }
      }
    }
  },
  {
    name: "cairn_task_update_node",
    description: "Edit task fields: title, estimate, due, context, optional. 반환: {task}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: { type: "number" },
        title: { type: "string" },
        estMinutes: { type: ["number", "null"] },
        due: { type: ["string", "null"] },
        context: { type: ["string", "null"] },
        optional: { type: "boolean" }
      }
    }
  },
  {
    name: "cairn_task_status",
    description: "Update task status. 반환: 갱신된 할 일 {id, threadId, title, estMinutes, due, context, optional, status, …}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status"],
      properties: {
        id: { type: "number" },
        status: { type: "string", enum: ["todo", "doing", "done", "dropped"] }
      }
    }
  },
  {
    name: "cairn_task_slot_candidates",
    description: "Preview schedule candidates for a due task. 반환: {task, candidates:[cairn_event_slot_candidates와 같은 후보]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "date", "now"],
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        now: { type: "string" },
        days: { type: "number" }
      }
    }
  },
  {
    name: "cairn_task_schedule_block",
    description: "Apply one task slot candidate as a scheduled block event. 반환: {task, event(만들어진 블록 일정)}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "date", "now", "start", "end"],
      properties: {
        id: { type: "number" },
        date: { type: "string" },
        now: { type: "string" },
        days: { type: "number" },
        start: { type: "string" },
        end: { type: "string" }
      }
    }
  },
  {
    name: "cairn_threads_list",
    description: "List threads. 반환: [{thread:{id, name, kind, goal, deadline, status, domain}, eventCount, taskCount, doneCount, totalCount, relationCounts}].",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { domain: { type: "string", enum: ["personal", "work", "all"] } }
    }
  },
  {
    name: "cairn_thread_detail",
    description: "Read thread detail. 반환: {thread, events[], tasks[], progress:{done, total}, relations:{incoming, outgoing}, rollup, nodeLinks[], unknownBlockers[], settlement, missingNodeSuggestions[], resume, personFocus}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "number" } }
    }
  },
  {
    name: "cairn_thread_create",
    description: "Create a thread. 반환: 생성된 thread {id, name, kind, goal, deadline, status, domain, createdAt}.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      required: ["name"],
      properties: {
        name: { type: "string" },
        kind: { type: "string" },
        domain: { type: "string", enum: ["personal", "work"] },
        why: { type: "string" }
      }
    }
  },
  {
    name: "cairn_thread_status",
    description: "Update thread status. 반환: {thread}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status"],
      properties: {
        id: { type: "number" },
        status: { type: "string", enum: ["active", "done", "dropped"] }
      }
    }
  },
  {
    name: "cairn_place_search",
    description: "Search Naver place candidates for authored event location text. 반환: {provider, candidates:[{title, category, address, roadAddress, description, naverUrl, locationText}]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string" } }
    }
  },
  {
    name: "cairn_watchers_list",
    description: "List watchers. 반환: {watchers:[{id, category, label, kind, armed, threshold, snoozedUntil, status, daysUntil, daysOverdue, message, reasonCodes[]}]}.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["date", "now"],
      properties: {
        date: { type: "string", description: "YYYY-MM-DD (daysUntil 기준일)" },
        now: { type: "string", description: "RFC3339 timestamp" }
      }
    }
  },
  {
    name: "cairn_watcher_create_date",
    description: "Create a date-threshold watcher. 반환: 생성된 watcher.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["label", "threshold"],
      properties: {
        label: { type: "string" },
        threshold: { type: "string", description: "YYYY-MM-DD" },
        category: { type: "string" }
      }
    }
  },
  {
    name: "cairn_provider_status",
    description: "Read map/place provider status diagnostics. 반환: {providers:[…]}.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_gcal_sync_status",
    description: "Read Google Calendar OAuth/token/sync status. 반환: {state, configured, tokenPresent, syncTokenPresent, lastSyncAt, tokenPath, message}.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_gcal_sync_run",
    description: "Run Google Calendar inbound sync now. Requires configured OAuth credentials and token. 반환: {status(cairn_gcal_sync_status와 같음), result:{upserted, cancelled, skipped}}.",
    inputSchema: EMPTY_SCHEMA
  }
];

export async function callTool(config: CairnApiClientConfig, name: string, rawArgs: JsonObject | undefined): Promise<McpToolResult> {
  try {
    const args = rawArgs ?? {};
    const response = await dispatchTool(config, name, args);
    // HTTP 4xx/5xx 도 isError 로 알려야 모델이 실패를 성공으로 읽지 않는다
    return textResult(response, isJsonObject(response) && response.ok === false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown tool error";
    return textResult({ ok: false, error: message }, true);
  }
}

async function dispatchTool(config: CairnApiClientConfig, name: string, args: JsonObject): Promise<JsonValue> {
  switch (name) {
    case "cairn_context_now":
      return request(config, { method: "GET", path: "/api/context/now", query: pickQuery(args, ["cwd", "now"]) });
    case "cairn_inbox":
      return request(config, { method: "GET", path: "/api/inbox", query: pickQuery(args, ["cwd", "limit"]) });
    case "cairn_confirm":
      return request(config, { method: "POST", path: `/api/inbox/${idArg(args)}/answer`, body: pickBody(args, ["decision", "value", "note", "snoozeHours", "answeredBy"]) });
    case "cairn_observe":
      return request(config, {
        method: "POST",
        path: "/api/observations",
        body: {
          source: "agent",
          body: args.body ?? null,
          ...(typeof args.title === "string" ? { title: args.title } : {}),
          ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
          ...(typeof args.agent === "string" ? { app: args.agent } : {})
        }
      });
    case "cairn_check_feasibility":
      return request(config, { method: "POST", path: "/api/feasibility/candidate", body: pickBody(args, ["title", "start", "end", "location", "online", "people", "kind", "abroad"]) });
    case "cairn_propose_event":
      return request(config, { method: "POST", path: "/api/inbox/propose-event", body: pickBody(args, ["title", "start", "end", "location", "online", "people", "kind", "abroad", "url", "origin", "note", "proposedBy"]) });
    case "cairn_plan_prep":
      return request(config, { method: "POST", path: "/api/watchers/reverse-plan", body: { category: "prep", safetyDays: 0, ...pickBody(args, ["label", "targetDate", "targetLabel", "safetyDays", "steps"]) } });
    case "cairn_event_capture_check":
      return request(config, { method: "GET", path: `/api/events/${idArg(args)}/capture-check` });
    case "cairn_material_attach":
      return request(config, { method: "POST", path: `/api/events/${idArg(args)}/materials`, body: pickBody(args, ["kind", "status", "label", "url", "expectedAt", "sourceUrl", "note", "addedBy"]) });
    case "cairn_material_update":
      return request(config, { method: "PATCH", path: `/api/materials/${idArg(args)}`, body: pickBody(args, ["status", "label", "url", "expectedAt", "sourceUrl", "note"]) });
    case "cairn_pin_route":
      return request(config, { method: "POST", path: "/api/routes/pin", body: pickBody(args, ["from", "to", "minutes", "note"]) });
    case "cairn_thread_workspace":
      return request(config, { method: "POST", path: "/api/thread-workspaces", body: pickBody(args, ["threadId", "path"]) });
    case "cairn_api_request":
      return request(config, apiRequestArgs(args));
    case "cairn_route_catalog":
      return { ok: true, data: { routes: API_ROUTE_CATALOG } };
    case "cairn_today_get":
      return request(config, { method: "GET", path: "/api/today", query: pickQuery(args, ["date", "now", "domain"]) });
    case "cairn_items_list":
      return request(config, { method: "GET", path: "/api/items", query: pickQuery(args, ["scope", "limit"]) });
    case "cairn_event_create":
      return request(config, { method: "POST", path: "/api/events", body: pickBody(args, ["title", "start", "end", "type", "location", "mode", "threadId", "personIds"]) });
    case "cairn_event_update_node":
      return request(config, { method: "PATCH", path: `/api/events/${idArg(args)}/thread-node`, body: pickBody(args, ["title", "type", "location", "mode"]) });
    case "cairn_event_status":
      return request(config, { method: "PATCH", path: `/api/events/${idArg(args)}/status`, body: pickBody(args, ["status"]) });
    case "cairn_event_geocode":
      return request(config, { method: "POST", path: `/api/events/${idArg(args)}/geocode` });
    case "cairn_event_slot_candidates":
      return request(config, { method: "GET", path: `/api/events/${idArg(args)}/slot-candidates`, query: pickQuery(args, ["date", "now", "days"]) });
    case "cairn_event_schedule":
      return request(config, { method: "PATCH", path: `/api/events/${idArg(args)}/schedule`, body: pickBody(args, ["date", "now", "days", "start", "end"]) });
    case "cairn_task_create":
      return request(config, { method: "POST", path: "/api/tasks", body: pickBody(args, ["title", "estMinutes", "due", "context", "threadId", "optional"]) });
    case "cairn_task_update_node":
      return request(config, { method: "PATCH", path: `/api/tasks/${idArg(args)}/thread-node`, body: pickBody(args, ["title", "estMinutes", "due", "context", "optional"]) });
    case "cairn_task_status":
      return request(config, { method: "PATCH", path: `/api/tasks/${idArg(args)}/status`, body: pickBody(args, ["status"]) });
    case "cairn_task_slot_candidates":
      return request(config, { method: "GET", path: `/api/tasks/${idArg(args)}/slot-candidates`, query: pickQuery(args, ["date", "now", "days"]) });
    case "cairn_task_schedule_block":
      return request(config, { method: "POST", path: `/api/tasks/${idArg(args)}/schedule-block`, body: pickBody(args, ["date", "now", "days", "start", "end"]) });
    case "cairn_threads_list":
      return request(config, { method: "GET", path: "/api/threads", query: pickQuery(args, ["domain"]) });
    case "cairn_thread_detail":
      return request(config, { method: "GET", path: `/api/threads/${idArg(args)}` });
    case "cairn_thread_create":
      return request(config, { method: "POST", path: "/api/threads", body: withoutId(args) });
    case "cairn_thread_status":
      return request(config, { method: "PATCH", path: `/api/threads/${idArg(args)}/status`, body: pickBody(args, ["status"]) });
    case "cairn_place_search":
      return request(config, { method: "GET", path: "/api/places/naver", query: pickQuery(args, ["query"]) });
    case "cairn_watchers_list":
      return request(config, { method: "GET", path: "/api/watchers", query: pickQuery(args, ["date", "now"]) });
    case "cairn_watcher_create_date":
      return request(config, { method: "POST", path: "/api/watchers", body: pickBody(args, ["label", "threshold", "category"]) });
    case "cairn_provider_status":
      return request(config, { method: "GET", path: "/api/providers/status" });
    case "cairn_gcal_sync_status":
      return request(config, { method: "GET", path: "/api/sync/gcal/status" });
    case "cairn_gcal_sync_run":
      return request(config, { method: "POST", path: "/api/sync/gcal/run" });
    default:
      throw new ToolInputError(`unknown tool: ${name}`);
  }
}

async function request(config: CairnApiClientConfig, req: CairnApiRequest): Promise<JsonValue> {
  return toJsonValue(await requestCairnApi(config, req));
}

function apiRequestArgs(args: JsonObject): CairnApiRequest {
  const method = args.method;
  if (!isApiMethod(method)) throw new ToolInputError("method must be GET, POST, PATCH, PUT, or DELETE");
  const path = stringArg(args, "path");
  const query = objectArg(args, "query");
  const timeoutMs = numberArg(args, "timeoutMs");
  const out: CairnApiRequest = { method, path };
  if (query !== undefined) out.query = query;
  if ("body" in args) out.body = args.body;
  if (timeoutMs !== undefined) out.timeoutMs = timeoutMs;
  return out;
}

function isApiMethod(value: JsonValue | undefined): value is ApiMethod {
  return value === "GET" || value === "POST" || value === "PATCH" || value === "PUT" || value === "DELETE";
}

function idArg(args: JsonObject): number {
  const id = numberArg(args, "id");
  if (id === undefined || id <= 0 || !Number.isInteger(id)) throw new ToolInputError("id must be a positive integer");
  return id;
}

function pickQuery(args: JsonObject, keys: string[]): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) {
    if (key in args && args[key] !== null) out[key] = args[key]!;
  }
  return out;
}

function pickBody(args: JsonObject, keys: string[]): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) {
    if (key in args) out[key] = args[key]!;
  }
  if (Object.keys(out).length === 0) throw new ToolInputError("request body must include at least one editable field");
  return out;
}

function withoutId(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (key !== "id") out[key] = value;
  }
  return out;
}

function stringArg(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new ToolInputError(`${key} must be a non-empty string`);
  return value;
}

function numberArg(args: JsonObject, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolInputError(`${key} must be a finite number`);
  return value;
}

function objectArg(args: JsonObject, key: string): JsonObject | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new ToolInputError(`${key} must be an object`);
  return value;
}

function textResult(value: JsonValue, isError?: boolean): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError === true ? { isError: true } : {})
  };
}
