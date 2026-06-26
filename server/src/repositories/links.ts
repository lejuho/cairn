import { and, eq, inArray, or } from "drizzle-orm";
import type { ThreadNodeLink } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { events, links, tasks } from "../db/schema.js";
import type { DependencyLinkRow } from "../services/sequence-order.js";

// Read-only: event-event dependency links (kind in requires|blocks) where AT
// LEAST ONE endpoint is in `dayEventIds`. The sequence-order service forms an
// edge only when BOTH endpoints are day events and flags one-endpoint-out links
// as out-of-scope — so this bounded read intentionally surfaces both. (cycle-48)
export function findEventDependencyLinks(
  db: CairnDatabase,
  dayEventIds: number[]
): DependencyLinkRow[] {
  if (dayEventIds.length === 0) return [];
  const rows = db
    .select({
      fromId: links.fromId,
      toId: links.toId,
      kind: links.kind,
      firmness: links.firmness
    })
    .from(links)
    .where(
      and(
        eq(links.fromKind, "event"),
        eq(links.toKind, "event"),
        inArray(links.kind, ["requires", "blocks"]),
        or(inArray(links.fromId, dayEventIds), inArray(links.toId, dayEventIds))
      )
    )
    .all();

  return rows.flatMap((r) => {
    if (r.fromId == null || r.toId == null || r.kind == null || r.firmness == null) return [];
    return [{
      fromId: r.fromId,
      toId: r.toId,
      kind: r.kind as DependencyLinkRow["kind"],
      firmness: r.firmness as DependencyLinkRow["firmness"]
    }];
  });
}

// ── Thread node links (cycle-50 FR-THR-05) ──────────────────────────────────────

type NodeEndpoint = { kind: "event" | "task"; id: number; title: string };

// In-thread event/task id → title lookups. Both endpoints of a node link must
// resolve through these, so deleted/threadless/cross-thread endpoints are
// excluded naturally.
function threadNodeTitles(db: CairnDatabase, threadId: number) {
  const eventRows = db.select({ id: events.id, title: events.title }).from(events).where(eq(events.threadId, threadId)).all();
  const taskRows = db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.threadId, threadId)).all();
  const eventTitles = new Map(eventRows.map((r) => [r.id, r.title ?? ""]));
  const taskTitles = new Map(taskRows.map((r) => [r.id, r.title ?? ""]));
  return { eventTitles, taskTitles };
}

function resolveEndpoint(
  kind: string | null,
  id: number | null,
  titles: { eventTitles: Map<number, string>; taskTitles: Map<number, string> }
): NodeEndpoint | null {
  if (id == null) return null;
  if (kind === "event" && titles.eventTitles.has(id)) return { kind: "event", id, title: titles.eventTitles.get(id)! };
  if (kind === "task" && titles.taskTitles.has(id)) return { kind: "task", id, title: titles.taskTitles.get(id)! };
  return null;
}

// Read-only: event/task `links` rows whose BOTH endpoints belong to `threadId`.
export function findThreadNodeLinks(db: CairnDatabase, threadId: number): ThreadNodeLink[] {
  const titles = threadNodeTitles(db, threadId);
  if (titles.eventTitles.size === 0 && titles.taskTitles.size === 0) return [];

  const rows = db
    .select()
    .from(links)
    .where(and(inArray(links.fromKind, ["event", "task"]), inArray(links.toKind, ["event", "task"])))
    .all();

  const out: ThreadNodeLink[] = [];
  for (const r of rows) {
    if (r.kind == null || r.firmness == null || r.source == null) continue;
    const from = resolveEndpoint(r.fromKind, r.fromId, titles);
    const to = resolveEndpoint(r.toKind, r.toId, titles);
    if (!from || !to) continue;
    out.push({
      id: r.id,
      kind: r.kind as ThreadNodeLink["kind"],
      firmness: r.firmness as ThreadNodeLink["firmness"],
      source: r.source as ThreadNodeLink["source"],
      from,
      to
    });
  }
  return out;
}

// Explicit firmness promotion (cycle-50 FR-THR-05). Returns null on any failure
// (unknown link, cross-thread, or missing endpoint) so the route yields 404.
// Promotion sets firmness='hard' AND source='authored' together, never writing
// the forbidden hard+inferred combination. Idempotent: an already hard/authored
// link returns reused=true with no write.
export function confirmThreadNodeLink(
  db: CairnDatabase,
  threadId: number,
  linkId: number
): { link: ThreadNodeLink; reused: boolean } | null {
  const [row] = db.select().from(links).where(eq(links.id, linkId)).all();
  if (!row || row.kind == null || row.firmness == null || row.source == null) return null;

  const titles = threadNodeTitles(db, threadId);
  const from = resolveEndpoint(row.fromKind, row.fromId, titles);
  const to = resolveEndpoint(row.toKind, row.toId, titles);
  if (!from || !to) return null; // endpoint not in this thread (cross-thread/missing)

  const alreadyConfirmed = row.firmness === "hard" && row.source === "authored";
  if (!alreadyConfirmed) {
    db.update(links).set({ firmness: "hard", source: "authored" }).where(eq(links.id, linkId)).run();
  }

  return {
    link: {
      id: row.id,
      kind: row.kind as ThreadNodeLink["kind"],
      firmness: "hard",
      source: "authored",
      from,
      to
    },
    reused: alreadyConfirmed
  };
}
