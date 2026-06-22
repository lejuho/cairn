import type {
  EffortBucket,
  MirrorLedgerData,
  MirrorLedgerEntry,
  MirrorOutcome
} from "@cairn/shared";
import type { MirrorSourceRow } from "../repositories/mirror.js";

const LOW_SAMPLE_THRESHOLD = 3;

export type MirrorLedgerOptions = {
  from?: string | undefined;
  to?: string | undefined;
  today: string; // server-local YYYY-MM-DD, injected for determinism
};

// loggedAt is stored as SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", no tz).
// We compare literal date prefixes; ISO date strings sort lexicographically, so
// string comparison is correct. The known UTC-vs-server-local skew is accepted
// at A-level and documented rather than papered over with SQL date() coercion.
export function buildMirrorLedger(rows: MirrorSourceRow[], opts: MirrorLedgerOptions): MirrorLedgerData {
  const to = opts.to ?? opts.today;
  const from = opts.from ?? minusDays(to, 30);

  const entries: MirrorLedgerEntry[] = [];
  for (const row of rows) {
    if (row.outcome !== "moved" && row.outcome !== "cancelled") continue;
    // Missing event join: ignored in A-level UI data (integration tests assert no crash).
    if (row.eventId == null || row.eventTitle == null) continue;

    const loggedAt = row.loggedAt ?? "";
    if (loggedAt === "") continue; // explicit: undated annotations are excluded
    const loggedDate = loggedAt.slice(0, 10);
    if (loggedDate < from || loggedDate > to) continue;

    entries.push(toEntry(row, row.outcome));
  }

  // Newest first by loggedAt, annotation id desc as tie-breaker.
  entries.sort((a, b) => {
    if (a.loggedAt !== b.loggedAt) return a.loggedAt < b.loggedAt ? 1 : -1;
    return b.annotationId - a.annotationId;
  });

  const summary = summarize(entries);
  return {
    range: { from, to },
    summary,
    entries,
    sampleStatus: summary.totalChanges < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok"
  };
}

function toEntry(row: MirrorSourceRow, outcome: MirrorOutcome): MirrorLedgerEntry {
  const money = row.cancelMoney ?? 0;
  const social = row.cancelSocial ?? 0;
  const effortRaw = (row.cancelEffort ?? "").trim().toLowerCase();
  const effortHasCost = effortRaw !== "" && effortRaw !== "none";
  const hasAnyCost = money > 0 || social > 0 || effortHasCost;

  return {
    annotationId: row.annotationId,
    eventId: row.eventId!,
    eventTitle: row.eventTitle!,
    thread: row.threadId != null && row.threadName != null
      ? { id: row.threadId, name: row.threadName }
      : null,
    outcome,
    reasonText: row.reasonText,
    reasonTags: parseReasonTags(row.reasonTags),
    loggedAt: row.loggedAt ?? "",
    eventStart: row.eventStart,
    cost: {
      money,
      social,
      effort: effortBucket(row.cancelEffort),
      window: row.cancelWindow,
      hasAnyCost
    }
  };
}

function summarize(entries: MirrorLedgerEntry[]): MirrorLedgerData["summary"] {
  const effortBreakdown = { none: 0, low: 0, medium: 0, high: 0, unknown: 0 };
  let movedCount = 0;
  let cancelledCount = 0;
  let freeCount = 0;
  let paidCount = 0;
  let moneyTotal = 0;
  let socialTotal = 0;

  for (const e of entries) {
    if (e.outcome === "moved") movedCount++;
    else cancelledCount++;
    if (e.cost.hasAnyCost) paidCount++;
    else freeCount++;
    moneyTotal += e.cost.money;
    socialTotal += e.cost.social;
    effortBreakdown[e.cost.effort]++;
  }

  return {
    totalChanges: entries.length,
    movedCount,
    cancelledCount,
    freeCount,
    paidCount,
    moneyTotal,
    socialTotal,
    effortBreakdown
  };
}

function effortBucket(raw: string | null): EffortBucket {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "none") return "none";
  if (v === "low") return "low";
  if (v === "medium") return "medium";
  if (v === "high") return "high";
  return "unknown"; // null, empty, or unrecognized
}

function parseReasonTags(raw: string | null): string[] {
  if (raw == null || raw === "") return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function minusDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}
