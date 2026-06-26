import type {
  CreateThreadDraftResponseData,
  EventRow,
  TaskRow,
  ThreadDraftParsed,
  ThreadRow
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, links, tasks, threads } from "../db/schema.js";
import type { LlmGateway } from "../llm/gateway.js";
import { parseThreadDraft } from "../llm/threadDraftParser.js";
import { findThreadNodeLinks } from "../repositories/links.js";
import { THREAD_ROW_COLUMNS } from "../repositories/threads.js";

const DEFAULT_TIMEZONE = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";

// Gateway error codes that mean "service temporarily unavailable" (retryable),
// distinct from a malformed/invalid draft (not retryable).
const UNAVAILABLE_CODES = new Set(["unavailable", "queue_full", "rate_limited", "invalid_response", "mock_not_allowed"]);

export type CreateThreadDraftInput = {
  text: string;
  now?: string;
  timeZone?: string;
};

export type CreateThreadDraftResult =
  | { status: "ok"; data: CreateThreadDraftResponseData }
  | { status: "llm_unavailable"; reason: string }
  | { status: "invalid_draft"; reason: string }
  | { status: "db_error"; reason: string };

// Every link endpoint must reference a node declared in the same draft, with a
// matching kind. A dangling or kind-mismatched reference invalidates the whole
// draft (no DB writes).
function validateLinks(draft: ThreadDraftParsed): string | null {
  const eventIds = new Set(draft.events.map((e) => e.tempId));
  const taskIds = new Set(draft.tasks.map((t) => t.tempId));
  if (eventIds.size !== draft.events.length) return "duplicate event tempId";
  if (taskIds.size !== draft.tasks.length) return "duplicate task tempId";
  const resolves = (kind: "event" | "task", tempId: string) =>
    kind === "event" ? eventIds.has(tempId) : taskIds.has(tempId);
  for (const link of draft.links) {
    if (!resolves(link.from.kind, link.from.tempId)) return `dangling link from ${link.from.kind}:${link.from.tempId}`;
    if (!resolves(link.to.kind, link.to.tempId)) return `dangling link to ${link.to.kind}:${link.to.tempId}`;
  }
  return null;
}

// Thread Draft A (cycle-51 FR-THR-02/03). Parses the description via the LLM
// boundary, validates draft invariants, then persists the thread + nodes +
// soft/inferred links in ONE transaction (all-or-none).
export async function createThreadDraft(
  db: CairnDatabase,
  gateway: LlmGateway,
  input: CreateThreadDraftInput
): Promise<CreateThreadDraftResult> {
  const now = input.now ?? new Date().toISOString();
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;

  const parsed = await parseThreadDraft(gateway, input.text, now, timeZone);
  if (parsed.error !== null) {
    if (UNAVAILABLE_CODES.has(parsed.error)) return { status: "llm_unavailable", reason: parsed.error };
    return { status: "invalid_draft", reason: parsed.error };
  }
  const draft = parsed.data;

  const invariant = validateLinks(draft);
  if (invariant) return { status: "invalid_draft", reason: invariant };

  try {
    const data = db.transaction((tx): CreateThreadDraftResponseData => {
      const [threadRow] = tx
        .insert(threads)
        .values({
          name: draft.thread.name,
          kind: draft.thread.kind ?? null,
          goal: draft.thread.goal ?? null,
          deadline: draft.thread.deadline ?? null,
          status: "active"
        })
        .returning(THREAD_ROW_COLUMNS)
        .all();
      const thread = threadRow as ThreadRow;

      const eventIdByTemp = new Map<string, number>();
      const insertedEvents: EventRow[] = [];
      for (const e of draft.events) {
        const [row] = tx
          .insert(events)
          .values({
            threadId: thread.id,
            title: e.title,
            type: e.type ?? null,
            start: e.start ?? null,
            end: e.end ?? null,
            location: e.location ?? null,
            mode: e.mode ?? null,
            source: "cairn",
            selfImposed: 1,
            status: "planned"
          })
          .returning()
          .all();
        insertedEvents.push(row as EventRow);
        eventIdByTemp.set(e.tempId, (row as EventRow).id);
      }

      const taskIdByTemp = new Map<string, number>();
      const insertedTasks: TaskRow[] = [];
      for (const t of draft.tasks) {
        const [row] = tx
          .insert(tasks)
          .values({
            threadId: thread.id,
            title: t.title,
            estMinutes: t.estMinutes ?? null,
            due: t.due ?? null,
            context: t.context ?? null,
            optional: t.optional ? 1 : 0,
            status: "todo"
          })
          .returning()
          .all();
        insertedTasks.push(row as TaskRow);
        taskIdByTemp.set(t.tempId, (row as TaskRow).id);
      }

      const idOf = (kind: "event" | "task", tempId: string) =>
        kind === "event" ? eventIdByTemp.get(tempId)! : taskIdByTemp.get(tempId)!;

      for (const link of draft.links) {
        tx.insert(links).values({
          fromId: idOf(link.from.kind, link.from.tempId),
          fromKind: link.from.kind,
          toId: idOf(link.to.kind, link.to.tempId),
          toKind: link.to.kind,
          kind: link.kind,
          // AI-derived dependency: stays unconfirmed/editable until the user
          // confirms it via the cycle-50 confirm endpoint.
          firmness: "soft",
          source: "inferred"
        }).run();
      }

      const nodeLinks = findThreadNodeLinks(tx as unknown as CairnDatabase, thread.id);
      return { thread, events: insertedEvents, tasks: insertedTasks, nodeLinks, warnings: draft.warnings };
    });
    return { status: "ok", data };
  } catch (err) {
    return { status: "db_error", reason: err instanceof Error ? err.message : String(err) };
  }
}
