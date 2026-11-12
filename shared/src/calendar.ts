import { z } from "zod";
import type { EventRow } from "./events.js";
import type { TaskRow } from "./tasks.js";

// 달력 화면: 한 구간(보통 달력 한 장 = 6주)의 일정·마감·메모 수를 한 번에 준다.
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const CALENDAR_MAX_DAYS = 62;

export const CalendarQuerySchema = z
  .object({ from: localDate, to: localDate })
  .strict()
  .refine((v) => v.from <= v.to, { message: "from must not be after to" })
  .refine((v) => (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 < CALENDAR_MAX_DAYS, {
    message: `range must be at most ${CALENDAR_MAX_DAYS} days`
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export type CalendarData = {
  from: string;
  to: string;
  timeZone: string;
  // 구간에 걸친 일정 (취소된 것 제외). 여러 날에 걸친 일정은 한 번만 들어 있다.
  events: EventRow[];
  // 마감(due)이 구간 안에 있는, 아직 끝나지 않은 할 일.
  tasks: TaskRow[];
  // 이미 결과(완료·이동·취소·늦음)가 기록된 일정 id. 외부 캘린더 동기화가 상태를 되돌려도
  // 다시 "결과 기록" 대상으로 뜨지 않게 한다.
  outcomeRecordedEventIds: number[];
  // 로컬 날짜 → 그날에 걸린 메모·체크리스트 수 (메모 날짜 또는 붙은 일정·할 일의 날짜).
  noteCounts: Record<string, number>;
};
