import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";
import { WatcherRowSchema } from "./watchers.js";

export const TodayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true })
});

export const ConflictPairSchema = z.object({
  a: EventRowSchema,
  b: EventRowSchema
});

export const TodaySurfaceSchema = z.object({
  date: z.string(),
  now: z.string(),
  state: z.enum(["quiet", "live"]),
  nextEvent: EventRowSchema.nullable(),
  conflicts: z.array(ConflictPairSchema),
  twoMinuteTasks: z.array(TaskRowSchema),
  watcherBubbles: z.array(WatcherRowSchema),
  cards: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("conflict"), pair: ConflictPairSchema }),
      z.object({ kind: z.literal("watcher"), watcher: WatcherRowSchema }),
      z.object({ kind: z.literal("next_event"), event: EventRowSchema }),
      z.object({ kind: z.literal("two_minute_task"), task: TaskRowSchema })
    ])
  )
});

export type TodayQuery = z.infer<typeof TodayQuerySchema>;
export type ConflictPair = z.infer<typeof ConflictPairSchema>;
export type TodaySurface = z.infer<typeof TodaySurfaceSchema>;
