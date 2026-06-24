import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";
import { WatcherABubbleSchema } from "./watchers.js";
import { DayFeasibilitySchema } from "./feasibility.js";

export const TodayQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  now: z.string().datetime({ offset: true })
});

export const ConflictPairSchema = z.object({
  a: EventRowSchema,
  b: EventRowSchema
});

// Deterministic placement metadata for needs-review cards (FR-FEAS-11 A-slice).
// Explanatory only: gives "why now" context, never hides/defers/auto-acts.
export const NeedsReviewPlacementModeSchema = z.enum([
  "low_context_slot",
  "stale_due",
  "no_context"
]);

export const NeedsReviewPlacementSchema = z
  .object({
    mode: NeedsReviewPlacementModeSchema,
    anchorEventId: z.number().int().positive().nullable(),
    ageHours: z.number().int().nonnegative().nullable(),
    reasonCodes: z.array(z.string())
  })
  .strict();

export const TodaySurfaceSchema = z.object({
  date: z.string(),
  now: z.string(),
  state: z.enum(["quiet", "live"]),
  nextEvent: EventRowSchema.nullable(),
  conflicts: z.array(ConflictPairSchema),
  twoMinuteTasks: z.array(TaskRowSchema),
  watcherBubbles: z.array(WatcherABubbleSchema),
  needsReviewEvents: z.array(EventRowSchema),
  unscheduledEvents: z.array(EventRowSchema),
  dayEvents: z.array(EventRowSchema),
  cards: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("conflict"), pair: ConflictPairSchema }),
      z.object({ kind: z.literal("watcher"), watcher: WatcherABubbleSchema }),
      z.object({ kind: z.literal("next_event"), event: EventRowSchema }),
      z.object({ kind: z.literal("two_minute_task"), task: TaskRowSchema }),
      z.object({ kind: z.literal("needs_review"), event: EventRowSchema, placement: NeedsReviewPlacementSchema }),
      z.object({ kind: z.literal("schedule_prompt"), event: EventRowSchema })
    ])
  ),
  feasibility: DayFeasibilitySchema
});

export type TodayQuery = z.infer<typeof TodayQuerySchema>;
export type ConflictPair = z.infer<typeof ConflictPairSchema>;
export type NeedsReviewPlacementMode = z.infer<typeof NeedsReviewPlacementModeSchema>;
export type NeedsReviewPlacement = z.infer<typeof NeedsReviewPlacementSchema>;
export type TodaySurface = z.infer<typeof TodaySurfaceSchema>;
