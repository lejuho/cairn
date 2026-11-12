import type { FastifyInstance } from "fastify";
import { and, inArray, isNotNull } from "drizzle-orm";
import { CalendarQuerySchema, type CalendarData, type TaskRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { annotations, tasks } from "../db/schema.js";
import { findEventsInRange } from "../repositories/events.js";
import { countNotesByDay, localDateOf } from "../services/notes.js";
import { addDays } from "../utils/rfc3339.js";
import { isRemoteAudience } from "../utils/audience.js";

function timeZone(): string {
  return process.env.CAIRN_TIME_ZONE?.trim() || "Asia/Seoul";
}

// 로컬 날짜의 자정을 그 시간대의 RFC3339 로. 한국처럼 서머타임이 없는 시간대를 전제로 오프셋을 한 번만 구한다.
function localMidnight(date: string, zone: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const offset = part === "GMT" ? "+00:00" : part.replace("GMT", "");
  return `${date}T00:00:00${offset}`;
}

export function registerCalendarRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/calendar", async (req, reply) => {
    const parsed = CalendarQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    const { from, to } = parsed.data;
    const zone = timeZone();
    const events = findEventsInRange(db, localMidnight(from, zone), localMidnight(addDays(to, 1), zone))
      .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));
    const dueTasks = (db.select().from(tasks).where(inArray(tasks.status, ["todo", "doing"])).all() as TaskRow[]).filter((task) => {
      const day = localDateOf(task.due);
      return day !== null && day >= from && day <= to;
    });
    const eventIds = events.map((e) => e.id);
    const recorded = eventIds.length === 0 ? [] : db
      .selectDistinct({ eventId: annotations.eventId })
      .from(annotations)
      .where(and(inArray(annotations.eventId, eventIds), isNotNull(annotations.outcome)))
      .all()
      .flatMap((row) => (row.eventId != null ? [row.eventId] : []));
    const data: CalendarData = { from, to, timeZone: zone, events, tasks: dueTasks, outcomeRecordedEventIds: recorded, noteCounts: countNotesByDay(db, from, to, { remoteOnly: isRemoteAudience(req) }) };
    return reply.send({ ok: true, data });
  });
}
