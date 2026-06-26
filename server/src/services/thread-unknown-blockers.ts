import type {
  EventRow,
  TaskRow,
  ThreadNodeLink,
  ThreadNodeRef,
  ThreadUnknownBlocker,
  ThreadUnknownBlockerBlockedField,
  ThreadUnknownBlockerMissingField,
  ThreadUnknownBlockerReasonCode
} from "@cairn/shared";

// Unknown Blocking A (cycle-52 FR-THR-04). Pure deterministic diagnostic — no
// DB, LLM, time, randomness, or mutation. Surfaces which missing upstream input
// blocks a downstream node's reverse planning, so the user knows what to fill.
// Read-only: it computes no dates and triggers no planning or inference.

// A-slice considers only requires/blocks. Other kinds wait for their direction
// to be specified.
const SCOPED_KINDS = new Set(["requires", "blocks"]);

// Deterministic field ordering so multiple blockers on one link sort stably.
const MISSING_FIELD_ORDER: ThreadUnknownBlockerMissingField[] = ["event.start", "event.end", "task.estMinutes"];

type ResolvedNode =
  | { ref: ThreadNodeRef; kind: "event"; row: EventRow }
  | { ref: ThreadNodeRef; kind: "task"; row: TaskRow };

function reasonForMissing(field: ThreadUnknownBlockerMissingField): ThreadUnknownBlockerReasonCode {
  if (field === "task.estMinutes") return "blocker_missing_duration";
  if (field === "event.start") return "blocker_missing_start";
  return "blocker_missing_end";
}

const MISSING_FIELD_TEXT: Record<ThreadUnknownBlockerMissingField, string> = {
  "task.estMinutes": "예상 소요 시간",
  "event.start": "시작 시각",
  "event.end": "종료 시각"
};

// `A requires B` → B must come before A: prerequisite=to, blocked=from.
// `A blocks B`   → A must come before B: prerequisite=from, blocked=to.
function normalizeDirection(link: ThreadNodeLink): { prerequisite: ThreadNodeRef; blockedNode: ThreadNodeRef } {
  if (link.kind === "requires") return { prerequisite: link.to, blockedNode: link.from };
  return { prerequisite: link.from, blockedNode: link.to };
}

export function computeThreadUnknownBlockers(
  events: EventRow[],
  tasks: TaskRow[],
  nodeLinks: ThreadNodeLink[]
): ThreadUnknownBlocker[] {
  const eventById = new Map(events.map((e) => [e.id, e]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const resolve = (ref: ThreadNodeRef): ResolvedNode | null => {
    if (ref.kind === "event") {
      const row = eventById.get(ref.id);
      return row ? { ref, kind: "event", row } : null;
    }
    const row = taskById.get(ref.id);
    return row ? { ref, kind: "task", row } : null;
  };

  const blockers: ThreadUnknownBlocker[] = [];

  for (const link of nodeLinks) {
    if (!SCOPED_KINDS.has(link.kind)) continue;
    const { prerequisite, blockedNode } = normalizeDirection(link);
    const prereq = resolve(prerequisite);
    const blocked = resolve(blockedNode);
    if (!prereq || !blocked) continue; // endpoint already filtered by findThreadNodeLinks; skip defensively

    // Reverse-planning target on the blocked node: event start or task due.
    let blockedField: ThreadUnknownBlockerBlockedField | null = null;
    if (blocked.kind === "event" && blocked.row.start != null) blockedField = "event.start";
    else if (blocked.kind === "task" && blocked.row.due != null) blockedField = "task.due";
    if (!blockedField) continue; // no target to block yet

    // Missing prerequisite inputs needed to plan backward.
    const missing: ThreadUnknownBlockerMissingField[] = [];
    if (prereq.kind === "task") {
      if (prereq.row.estMinutes == null) missing.push("task.estMinutes");
    } else {
      if (prereq.row.start == null) missing.push("event.start");
      if (prereq.row.end == null) missing.push("event.end");
    }
    if (missing.length === 0) continue;

    const softLink = link.firmness !== "hard";
    for (const missingField of missing) {
      const reasonCodes: ThreadUnknownBlockerReasonCode[] = [reasonForMissing(missingField)];
      if (softLink) reasonCodes.push("blocker_soft_link");
      blockers.push({
        id: `link:${link.id}:${missingField}`,
        linkId: link.id,
        linkKind: link.kind,
        firmness: link.firmness,
        source: link.source,
        prerequisite: prereq.ref,
        blockedNode: blocked.ref,
        missingField,
        blockedField,
        message: `‘${prereq.ref.title}’의 ${MISSING_FIELD_TEXT[missingField]}이(가) 없어 ‘${blocked.ref.title}’ 일정을 역산할 수 없어.`,
        reasonCodes
      });
    }
  }

  // Deterministic order: by link id, then missing-field order, then id string.
  blockers.sort((a, b) => {
    if (a.linkId !== b.linkId) return a.linkId - b.linkId;
    const fa = MISSING_FIELD_ORDER.indexOf(a.missingField);
    const fb = MISSING_FIELD_ORDER.indexOf(b.missingField);
    if (fa !== fb) return fa - fb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return blockers;
}
