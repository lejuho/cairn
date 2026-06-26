import type {
  ThreadStarDraft,
  ThreadStarDraftEvidence,
  ThreadStarDraftResponseData
} from "@cairn/shared";
import { ThreadStarDraftSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { findThreadById, findEventsByThreadId, findTasksByThreadId } from "../repositories/threads.js";
import { findEventsWithCostsByThreadId } from "../repositories/events.js";
import { findAnnotationsByEventIds } from "../repositories/annotations.js";
import { computeThreadSettlement } from "./thread-settlement.js";
import { parseThreadStarDraft, type StarDraftPromptInput } from "../llm/threadStarDraftParser.js";

// Gateway codes that mean "temporarily unavailable" (retryable), distinct from a
// malformed/invalid draft.
const UNAVAILABLE_CODES = new Set(["unavailable", "queue_full", "rate_limited", "invalid_response", "mock_not_allowed"]);

export type GenerateThreadStarDraftResult =
  | { status: "ok"; data: ThreadStarDraftResponseData }
  | { status: "not_found" }
  | { status: "not_done" }
  | { status: "llm_unavailable"; reason: string }
  | { status: "invalid_draft"; reason: string };

function settlementSummary(s: ThreadStarDraftEvidence["settlement"]): string {
  const p = s.paidCost;
  const a = s.avoidedMissing;
  // Explicitly state that avoided money is unavailable so Result cannot claim a
  // monetary figure.
  return `paid: ${p.eventCount} moved/cancelled events (money ${p.money}, social ${p.social}); completed ${a.doneCount}/${a.totalCount}; avoided-cost money is UNAVAILABLE (do not state any amount).`;
}

// Thread STAR Draft A (cycle-55 FR-CV-01). Builds completed-thread evidence,
// asks the LLM for STAR narrative text, and returns an ephemeral draft. No DB
// write on any path.
export async function generateThreadStarDraft(
  db: CairnDatabase,
  gateway: LlmGateway,
  id: number
): Promise<GenerateThreadStarDraftResult> {
  const thread = findThreadById(db, id);
  if (!thread) return { status: "not_found" };
  if (thread.status !== "done") return { status: "not_done" };

  const events = findEventsByThreadId(db, id);
  const tasks = findTasksByThreadId(db, id);
  const settlement = computeThreadSettlement(thread, findEventsWithCostsByThreadId(db, id), tasks);
  const annotationRows = findAnnotationsByEventIds(db, events.map((e) => e.id));

  const nodeTitles = [...events, ...tasks].map((n) => n.title).filter((t): t is string => t != null && t.trim() !== "");

  const warnings: string[] = [];
  if (thread.goal == null || thread.goal.trim() === "") warnings.push("이 스레드에는 목표가 기록되어 있지 않아.");
  if (annotationRows.length === 0) warnings.push("직접 이벤트에 남긴 기록(주석)이 없어.");
  if (settlement.avoidedMissing.moneyStatus === "unavailable") warnings.push("피한 비용의 금액은 알 수 없어 — 결과에 금액을 단정하지 않아.");

  const evidence: ThreadStarDraftEvidence = {
    thread: { id: thread.id, name: thread.name, kind: thread.kind, goal: thread.goal, deadline: thread.deadline },
    nodeTitles,
    annotationCount: annotationRows.length,
    settlement,
    warnings
  };

  const promptInput: StarDraftPromptInput = {
    thread: { name: thread.name, kind: thread.kind, goal: thread.goal, deadline: thread.deadline },
    nodes: [
      ...events.map((e) => ({ title: e.title, status: e.status, kind: "event" as const })),
      ...tasks.map((t) => ({ title: t.title, status: t.status, kind: "task" as const }))
    ].filter((n) => n.title != null && n.title.trim() !== ""),
    annotations: annotationRows.map((a) => ({ outcome: a.outcome, reasonText: a.reasonText })),
    settlementSummary: settlementSummary(settlement)
  };

  const parsed = await parseThreadStarDraft(gateway, promptInput);
  if (parsed.error !== null) {
    if (UNAVAILABLE_CODES.has(parsed.error)) return { status: "llm_unavailable", reason: parsed.error };
    return { status: "invalid_draft", reason: parsed.error };
  }

  // confidence + reasonCodes are forced here — never chosen by the model.
  const draft: ThreadStarDraft = {
    ...parsed.data,
    confidence: "draft",
    reasonCodes: ["star_from_completed_thread", "star_user_must_edit", "star_result_uses_settlement"]
  };
  const validated = ThreadStarDraftSchema.safeParse(draft);
  if (!validated.success) return { status: "invalid_draft", reason: "assembled_draft_invalid" };

  return { status: "ok", data: { draft: validated.data, evidence } };
}
