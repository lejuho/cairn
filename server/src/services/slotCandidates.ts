import type { EventRow, SlotCandidate } from "@cairn/shared";
import { addMinutesToRfc3339 } from "../llm/flatEventParser.js";
import { findEventsInRange } from "../repositories/events.js";
import type { CairnDatabase } from "../db/index.js";

const WINDOW_HOURS = [9, 11, 14, 16, 19];
const DURATION_MINUTES = 60;
const MAX_CANDIDATES = 3;

function extractOffset(rfc3339: string): string {
  const m = rfc3339.match(/([+-]\d{2}:\d{2})$/);
  return m ? m[1]! : "+00:00";
}

function buildCandidateStart(dateStr: string, hour: number, offset: string): string {
  const hh = String(hour).padStart(2, "0");
  return `${dateStr}T${hh}:00:00${offset}`;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function generateSlotCandidates(
  db: CairnDatabase,
  event: EventRow,
  nowStr: string,
  startDate: string,
  days: number
): SlotCandidate[] {
  const offset = extractOffset(nowStr);
  const candidates: SlotCandidate[] = [];

  for (let day = 0; day < days && candidates.length < MAX_CANDIDATES; day++) {
    const dateStr = addDays(startDate, day);
    for (const hour of WINDOW_HOURS) {
      if (candidates.length >= MAX_CANDIDATES) break;

      const start = buildCandidateStart(dateStr, hour, offset);
      const end = addMinutesToRfc3339(start, DURATION_MINUTES);

      if (start <= nowStr) continue;

      const overlapping = findEventsInRange(db, start, end);
      if (overlapping.some((e) => e.id !== event.id)) continue;

      const reasons = [`${dateStr} ${String(hour).padStart(2, "0")}:00 — 빈 시간`];
      const reasonCodes = ["free_window"];
      candidates.push({ start, end, reasons, reasonCodes });
    }
  }

  return candidates;
}
