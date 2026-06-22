import type { MirrorPatternBucket, MirrorPatternThreadBucket, MirrorPatternsData } from "@cairn/shared";
import { isCalendarDate } from "@cairn/shared";
import type { MirrorSourceRow } from "../repositories/mirror.js";

const LOW_SAMPLE_THRESHOLD = 3;

// Weekday order: Mon(1)→Tue(2)→...→Sun(0)→unknown. getUTCDay() returns 0=Sun..6=Sat.
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "unknown"] as const;
const WEEKDAY_LABELS: Record<string, string> = {
  monday: "월요일",
  tuesday: "화요일",
  wednesday: "수요일",
  thursday: "목요일",
  friday: "금요일",
  saturday: "토요일",
  sunday: "일요일",
  unknown: "날짜 미상"
};
// getUTCDay() index → weekday key
const UTC_DAY_TO_KEY: Record<number, string> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday"
};

export type MirrorPatternsOptions = {
  from?: string | undefined;
  to?: string | undefined;
  today: string; // server-local YYYY-MM-DD, injected for determinism
};

type OutcomeCounts = { done: number; moved: number; cancelled: number; late: number };
type BucketAcc = { outcomes: OutcomeCounts; total: number };

export function buildMirrorPatterns(rows: MirrorSourceRow[], opts: MirrorPatternsOptions): MirrorPatternsData {
  const to = opts.to ?? opts.today;
  const from = opts.from ?? minusDays(to, 30);

  // Filter: valid outcome, event join present, loggedAt in [from, to].
  const filtered: MirrorSourceRow[] = [];
  for (const row of rows) {
    const outcome = row.outcome;
    if (outcome !== "done" && outcome !== "moved" && outcome !== "cancelled" && outcome !== "late") continue;
    if (row.eventId == null) continue;
    const loggedAt = row.loggedAt ?? "";
    if (loggedAt === "") continue;
    const loggedDate = loggedAt.slice(0, 10);
    if (loggedDate < from || loggedDate > to) continue;
    filtered.push(row);
  }

  // Totals
  const totals = { annotations: 0, done: 0, moved: 0, cancelled: 0, late: 0, slipCount: 0 };
  for (const row of filtered) {
    totals.annotations++;
    const o = row.outcome as "done" | "moved" | "cancelled" | "late";
    totals[o]++;
  }
  totals.slipCount = totals.moved + totals.cancelled + totals.late;

  // Bucket accumulators
  const weekdayMap = new Map<string, BucketAcc>();
  const typeMap = new Map<string, BucketAcc>();
  const threadMap = new Map<string, { acc: BucketAcc; thread: { id: number; name: string } | null; label: string }>();

  for (const row of filtered) {
    const o = row.outcome as "done" | "moved" | "cancelled" | "late";

    // Weekday bucket: from events.start, extracted as calendar date and converted
    // to UTC weekday. Using UTC avoids host-tz dependence; accepted skew is the
    // same as the loggedAt UTC-vs-server-local tradeoff documented in cycle 27.
    const wdKey = weekdayFromStart(row.eventStart);
    accumulate(weekdayMap, wdKey, o);

    // Type bucket: null/blank → "unknown"
    const typeKey = (row.eventType ?? "").trim() || "unknown";
    accumulate(typeMap, typeKey, o);

    // Thread bucket
    const threadKey = row.threadId != null ? `thread:${row.threadId}` : "thread:null";
    const threadEntry = threadMap.get(threadKey);
    if (threadEntry == null) {
      threadMap.set(threadKey, {
        acc: newBucket(o),
        thread: row.threadId != null && row.threadName != null
          ? { id: row.threadId, name: row.threadName }
          : null,
        label: row.threadName ?? "스레드 없음"
      });
    } else {
      addOutcome(threadEntry.acc, o);
    }
  }

  const weekday = buildWeekdayBuckets(weekdayMap);
  const type = buildSortedBuckets(typeMap);
  const thread = buildThreadBuckets(threadMap);

  const totalAnnotations = totals.annotations;
  const sampleStatus = totalAnnotations < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok";

  return { range: { from, to }, totals, weekday, type, thread, sampleStatus };
}

function weekdayFromStart(start: string | null): string {
  if (start == null) return "unknown";
  const datePart = start.slice(0, 10);
  // NaN guard alone is insufficient: "2026-02-30" parses without NaN but rolls
  // to 2026-03-02. Round-trip check rejects overflow dates the same way
  // isCalendarDate() does in the shared schema layer.
  if (!isCalendarDate(datePart)) return "unknown";
  const ms = Date.parse(`${datePart}T00:00:00Z`);
  return UTC_DAY_TO_KEY[new Date(ms).getUTCDay()] ?? "unknown";
}

function newBucket(o: "done" | "moved" | "cancelled" | "late"): BucketAcc {
  const acc: BucketAcc = { outcomes: { done: 0, moved: 0, cancelled: 0, late: 0 }, total: 0 };
  addOutcome(acc, o);
  return acc;
}

function addOutcome(acc: BucketAcc, o: "done" | "moved" | "cancelled" | "late"): void {
  acc.outcomes[o]++;
  acc.total++;
}

function accumulate(map: Map<string, BucketAcc>, key: string, o: "done" | "moved" | "cancelled" | "late"): void {
  const existing = map.get(key);
  if (existing == null) {
    map.set(key, newBucket(o));
  } else {
    addOutcome(existing, o);
  }
}

function toBucket(key: string, label: string, acc: BucketAcc): MirrorPatternBucket {
  const slipCount = acc.outcomes.moved + acc.outcomes.cancelled + acc.outcomes.late;
  const slipRatio = acc.total > 0 ? Math.round((slipCount / acc.total) * 1000) / 1000 : 0;
  return {
    key,
    label,
    total: acc.total,
    outcomes: acc.outcomes,
    slipCount,
    slipRatio,
    sampleStatus: acc.total < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok"
  };
}

function buildWeekdayBuckets(map: Map<string, BucketAcc>): MirrorPatternBucket[] {
  // Stable order: Mon→Tue→Wed→Thu→Fri→Sat→Sun→unknown
  const result: MirrorPatternBucket[] = [];
  for (const key of WEEKDAY_KEYS) {
    const acc = map.get(key);
    if (acc != null) result.push(toBucket(key, WEEKDAY_LABELS[key] ?? key, acc));
  }
  return result;
}

function buildSortedBuckets(map: Map<string, BucketAcc>): MirrorPatternBucket[] {
  // total desc, slipCount desc, label asc, key asc
  return Array.from(map.entries())
    .map(([key, acc]) => toBucket(key, key, acc))
    .sort(bucketComparator);
}

function buildThreadBuckets(
  map: Map<string, { acc: BucketAcc; thread: { id: number; name: string } | null; label: string }>
): MirrorPatternThreadBucket[] {
  return Array.from(map.entries())
    .map(([key, { acc, thread, label }]): MirrorPatternThreadBucket => {
      const slipCount = acc.outcomes.moved + acc.outcomes.cancelled + acc.outcomes.late;
      const slipRatio = acc.total > 0 ? Math.round((slipCount / acc.total) * 1000) / 1000 : 0;
      return {
        key,
        thread,
        label,
        total: acc.total,
        outcomes: acc.outcomes,
        slipCount,
        slipRatio,
        sampleStatus: acc.total < LOW_SAMPLE_THRESHOLD ? "low_sample" : "ok"
      };
    })
    .sort(bucketComparator);
}

function bucketComparator(a: { total: number; slipCount: number; label: string; key: string }, b: typeof a): number {
  if (b.total !== a.total) return b.total - a.total;
  if (b.slipCount !== a.slipCount) return b.slipCount - a.slipCount;
  if (a.label !== b.label) return a.label < b.label ? -1 : 1;
  return a.key < b.key ? -1 : 1;
}

function minusDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}
