import type { calendar_v3 } from "googleapis";

export type LocalEventInsert = {
  title: string;
  start: string | null;
  end: string | null;
  type: string | null;
  source: "gcal";
  selfImposed: 0;
  status: "planned" | "confirmed" | "cancelled";
  externalCalendarId: string;
  externalEventId: string;
  externalIcalUid: string | null;
  externalEtag: string | null;
  externalUpdated: string | null;
};

export function mapGcalEvent(
  calendarId: string,
  item: calendar_v3.Schema$Event,
  timeZone: string
): LocalEventInsert | null {
  const externalEventId = item.id;
  if (!externalEventId) return null;

  const status = mapStatus(item.status);

  return {
    title: item.summary ?? "",
    start: mapStart(item.start, timeZone),
    end: mapEnd(item.end, timeZone),
    type: item.start?.date != null ? "all_day" : null,
    source: "gcal",
    selfImposed: 0,
    status,
    externalCalendarId: calendarId,
    externalEventId,
    externalIcalUid: item.iCalUID ?? null,
    externalEtag: item.etag ?? null,
    externalUpdated: item.updated ?? null
  };
}

function mapStatus(
  gcalStatus: string | null | undefined
): "planned" | "confirmed" | "cancelled" {
  if (gcalStatus === "confirmed") return "confirmed";
  if (gcalStatus === "cancelled") return "cancelled";
  return "planned";
}

function mapStart(
  start: calendar_v3.Schema$EventDateTime | undefined,
  timeZone: string
): string | null {
  if (!start) return null;
  if (start.dateTime) return start.dateTime;
  if (start.date) return allDayToMidnightRfc3339(start.date, timeZone);
  return null;
}

function mapEnd(
  end: calendar_v3.Schema$EventDateTime | undefined,
  timeZone: string
): string | null {
  if (!end) return null;
  if (end.dateTime) return end.dateTime;
  if (end.date) return allDayToMidnightRfc3339(end.date, timeZone);
  return null;
}

/**
 * Converts a Google Calendar all-day date string ("YYYY-MM-DD") to a
 * midnight RFC3339 timestamp in the given IANA timezone.
 *
 * Avoids new Date("YYYY-MM-DD") which parses as UTC midnight, not local.
 */
export function allDayToMidnightRfc3339(date: string, timeZone: string): string {
  const [yearStr, monthStr, dayStr] = date.split("-");
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);

  // Binary-search the UTC instant that corresponds to midnight in timeZone.
  // We bracket around noon UTC on the target date (±14h covers all zones).
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  const utcMs = findMidnightUtcMs(year, month, day, timeZone, noonUtc);

  return new Date(utcMs).toISOString().replace("Z", "+00:00");
}

function findMidnightUtcMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  approxUtcMs: number
): number {
  // Narrow down by iterating: start from approx UTC noon, step by seconds
  // toward midnight in the target timezone.
  // Use Intl to check what local date/time a UTC ms maps to.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  // Estimate offset: parse what UTC noon looks like in the target timezone.
  const noonParts = parseDateTimeParts(fmt, approxUtcMs);
  // UTC offset at noon ≈ local time - UTC time. Compute approximate offset.
  const localNoonMs =
    Date.UTC(
      noonParts.year,
      noonParts.month - 1,
      noonParts.day,
      noonParts.hour,
      noonParts.minute,
      noonParts.second
    );
  const offsetMs = localNoonMs - approxUtcMs;

  // Estimated UTC ms for midnight local = (target midnight local) - offset
  const targetMidnightLocalMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utcMs = targetMidnightLocalMs - offsetMs;

  // Verify and nudge (handles DST boundary within ±2h).
  for (let tries = 0; tries < 8; tries++) {
    const parts = parseDateTimeParts(fmt, utcMs);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === 0 &&
      parts.minute === 0 &&
      parts.second === 0
    ) {
      return utcMs;
    }
    // Nudge toward target midnight.
    const localMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    utcMs -= localMs - targetMidnightLocalMs;
  }
  return utcMs;
}

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseDateTimeParts(
  fmt: Intl.DateTimeFormat,
  utcMs: number
): DateTimeParts {
  const parts = fmt.formatToParts(utcMs);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}
