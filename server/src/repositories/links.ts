import { and, eq, inArray, or } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { links } from "../db/schema.js";
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
