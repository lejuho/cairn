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

const EMPTY_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false
};

export const TOOLS: McpTool[] = [
  {
    name: "cairn_context_now",
    description: "지금의 맥락: 진행 중/24시간 내 일정, 활성 thread(현재 작업 디렉터리에 묶인 것 우선), 확인 대기 질문 상위 5개. 사용자가 '뭐부터 하지', '오늘 어때' 같은 걸 물으면 먼저 호출.",
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
    description: "사용자에게 확인할 질문 목록(우선순위 순). 대화 흐름이 끊기지 않는 시점에 1~2개만 자연스럽게 물어보고, 답을 받으면 cairn_confirm 으로 기록. 각 항목의 answerHint 를 따를 것.",
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
    description: "inbox 질문에 대한 사용자의 답을 기록. 사용자가 실제로 답한 것만 기록하고 추측으로 accept 하지 말 것. decision: accept|reject|dismiss|snooze.",
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
    description: "대화 중 드러난 사실/결정/약속을 관찰로 기록 (추론 재료). 확정 일정이 아니라 원문 메모. 예: '다음 주 화요일 BAY 운영진 회의 잡힘'.",
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
    name: "cairn_thread_workspace",
    description: "작업 디렉터리를 thread 에 묶는다. 이후 그 디렉터리의 세션에서 해당 thread 질문이 우선 노출된다.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["threadId", "path"],
      properties: { threadId: { type: "number" }, path: { type: "string" } }
    }
  },
  {
    name: "cairn_api_request",
    description: "Call any Cairn HTTP endpoint on the configured Cairn API base URL. Path is limited to /api/* or /health.",
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
    description: "List Cairn API routes exposed through cairn_api_request.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_today_get",
    description: "Read the Today surface.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        now: { type: "string", description: "RFC3339 timestamp" },
        domain: { type: "string", enum: ["personal", "work", "all"] }
      }
    }
  },
  {
    name: "cairn_items_list",
    description: "List event/task inventory.",
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
    description: "Create a scheduled Cairn event.",
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
    description: "Edit event node fields: title, type, location, mode.",
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
    description: "Update event status.",
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
    description: "Geocode an event's authored location and update the geocode cache.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "number" } }
    }
  },
  {
    name: "cairn_event_slot_candidates",
    description: "Preview schedule candidates for an unscheduled event.",
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
    description: "Apply one event slot candidate.",
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
    description: "Create a Cairn task.",
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
    description: "Edit task fields: title, estimate, due, context, optional.",
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
    description: "Update task status.",
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
    description: "Preview schedule candidates for a due task.",
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
    description: "Apply one task slot candidate as a scheduled block event.",
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
    description: "List threads.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { domain: { type: "string", enum: ["personal", "work", "all"] } }
    }
  },
  {
    name: "cairn_thread_detail",
    description: "Read thread detail.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "number" } }
    }
  },
  {
    name: "cairn_thread_create",
    description: "Create a thread.",
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
    description: "Update thread status.",
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
    description: "Search Naver place candidates for authored event location text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string" } }
    }
  },
  {
    name: "cairn_watchers_list",
    description: "List watchers.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { scope: { type: "string" } }
    }
  },
  {
    name: "cairn_watcher_create_date",
    description: "Create a date-threshold watcher.",
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
    description: "Read map/place provider status diagnostics.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_gcal_sync_status",
    description: "Read Google Calendar OAuth/token/sync status.",
    inputSchema: EMPTY_SCHEMA
  },
  {
    name: "cairn_gcal_sync_run",
    description: "Run Google Calendar inbound sync now. Requires configured OAuth credentials and token.",
    inputSchema: EMPTY_SCHEMA
  }
];

export async function callTool(config: CairnApiClientConfig, name: string, rawArgs: JsonObject | undefined): Promise<McpToolResult> {
  try {
    const args = rawArgs ?? {};
    const response = await dispatchTool(config, name, args);
    return textResult(response);
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
      return request(config, { method: "GET", path: "/api/watchers", query: pickQuery(args, ["scope"]) });
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
