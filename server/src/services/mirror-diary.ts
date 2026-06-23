import type { MirrorSourceRow } from "../repositories/mirror.js";
import type {
  MirrorDiaryData,
  MirrorDiaryDay,
  MirrorDiaryEntry
} from "@cairn/shared";

export function buildMirrorDiary(
  rows: MirrorSourceRow[],
  range: { from: string; to: string }
): MirrorDiaryData {
  const { from, to } = range;

  // Filter to range, exclude orphan rows.
  const valid = rows.filter(
    (r) =>
      r.eventId != null &&
      r.eventTitle != null &&
      r.loggedAt != null &&
      r.outcome != null &&
      r.loggedAt.slice(0, 10) >= from &&
      r.loggedAt.slice(0, 10) <= to
  );

  // Group by calendar date (newest-first via Map insertion order).
  // Rows arrive ordered by loggedAt desc, id desc from repository.
  const byDate = new Map<string, typeof valid>();
  for (const row of valid) {
    const date = row.loggedAt!.slice(0, 10);
    const bucket = byDate.get(date);
    if (bucket) {
      bucket.push(row);
    } else {
      byDate.set(date, [row]);
    }
  }

  // Sort dates newest-first.
  const sortedDates = [...byDate.keys()].sort((a, b) => (a > b ? -1 : 1));

  const days: MirrorDiaryDay[] = sortedDates.map((date) => {
    const dayRows = byDate.get(date)!;
    const entries: MirrorDiaryEntry[] = dayRows.map((r) => buildEntry(r));

    // Headline: first non-empty (non-whitespace) reasonText.
    const headline =
      entries.find((e) => e.reasonText != null && e.reasonText.trim() !== "")
        ?.reasonText ?? null;

    return { date, headline, entries };
  });

  const totalEntries = days.reduce((s, d) => s + d.entries.length, 0);

  return {
    range,
    days,
    sampleStatus: totalEntries < 3 ? "low_sample" : "ok"
  };
}

function buildEntry(r: MirrorSourceRow): MirrorDiaryEntry {
  const reasonText = r.reasonText?.trim() || null;
  const depth = reasonText ? "semi_auto" : "automatic";
  const contextLabel = buildContextLabel(r);

  let reasonTags: string[] = [];
  if (r.reasonTags) {
    try {
      const parsed = JSON.parse(r.reasonTags);
      if (Array.isArray(parsed)) reasonTags = parsed.filter((t) => typeof t === "string");
    } catch {
      // ignore malformed JSON
    }
  }

  return {
    annotationId: r.annotationId,
    eventId: r.eventId!,
    eventTitle: r.eventTitle!,
    eventStart: r.eventStart ?? null,
    thread:
      r.threadId != null && r.threadName != null
        ? { id: r.threadId, name: r.threadName }
        : null,
    outcome: r.outcome!,
    reasonText,
    reasonTags,
    loggedAt: r.loggedAt!,
    depth,
    contextLabel
  };
}

function buildContextLabel(r: MirrorSourceRow): string {
  const parts: string[] = [];
  if (r.eventTitle) parts.push(r.eventTitle);
  if (r.outcome) {
    const label =
      r.outcome === "moved"
        ? "이동"
        : r.outcome === "cancelled"
          ? "취소"
          : r.outcome === "done"
            ? "완료"
            : r.outcome === "late"
              ? "지각"
              : r.outcome;
    parts.push(label);
  }
  return parts.join(" / ");
}
