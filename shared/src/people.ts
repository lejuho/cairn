import { z } from "zod";
import { EventRowSchema } from "./events.js";

export const PersonChannelSchema = z.enum(["none", "kakao", "sms", "email", "telegram"]);
export type PersonChannel = z.infer<typeof PersonChannelSchema>;

export const FrequencyBandSchema = z.enum(["cold_start", "rare", "established", "frequent"]);
export type FrequencyBand = z.infer<typeof FrequencyBandSchema>;

export const WeekdaySchema = z.enum([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
]);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const HardConstraintSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("weekday_unavailable"),
    weekday: WeekdaySchema,
    text: z.string(),
    firmness: z.literal("hard")
  })
]);
export type HardConstraint = z.infer<typeof HardConstraintSchema>;

export const PreferredPeriodSchema = z.enum(["morning", "afternoon", "evening"]);
export type PreferredPeriod = z.infer<typeof PreferredPeriodSchema>;

export const AuthoredPreferredWindowsSchema = z.object({
  weekdays: z.array(WeekdaySchema).min(1),
  periods: z.array(PreferredPeriodSchema).min(1),
  firmness: z.literal("hard")
});
export type AuthoredPreferredWindows = z.infer<typeof AuthoredPreferredWindowsSchema>;

export const AuthoredLeadTimeSchema = z.object({
  days: z.number().int().min(0).max(30),
  firmness: z.literal("hard")
});
export type AuthoredLeadTime = z.infer<typeof AuthoredLeadTimeSchema>;

export const PersonRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  relation: z.string().nullable(),
  channel: PersonChannelSchema.nullable(),
  hardConstraints: z.array(HardConstraintSchema).optional(),
  preferredWindows: AuthoredPreferredWindowsSchema.nullable().optional(),
  leadTime: AuthoredLeadTimeSchema.nullable().optional()
});
export type PersonRow = z.infer<typeof PersonRowSchema>;

export const ReplaceHardConstraintsRequestSchema = z.object({
  unavailableWeekdays: z.array(WeekdaySchema)
});
export type ReplaceHardConstraintsRequest = z.infer<typeof ReplaceHardConstraintsRequestSchema>;

// All five authored fields replaced atomically. Both weekdays and periods must
// be non-empty together or both absent; a half-empty window is rejected.
export const UpdatePersonProfileRequestSchema = z.object({
  preferredWeekdays: z.array(WeekdaySchema),
  preferredPeriods: z.array(PreferredPeriodSchema),
  leadTimeDays: z.number().int().min(0).max(30).nullable(),
  channel: PersonChannelSchema,
  unavailableWeekdays: z.array(WeekdaySchema)
})
  .refine(
    (v) => (v.preferredWeekdays.length > 0) === (v.preferredPeriods.length > 0),
    { message: "preferredWeekdays and preferredPeriods must both be non-empty or both empty", path: ["preferredPeriods"] }
  )
  .refine(
    (v) => !v.preferredWeekdays.some((d) => v.unavailableWeekdays.includes(d)),
    { message: "preferredWeekdays and unavailableWeekdays must not overlap", path: ["unavailableWeekdays"] }
  );
export type UpdatePersonProfileRequest = z.infer<typeof UpdatePersonProfileRequestSchema>;

export const CreatePersonRequestSchema = z.object({
  displayName: z.string().min(1),
  relation: z.string().optional(),
  channel: PersonChannelSchema
});
export type CreatePersonRequest = z.infer<typeof CreatePersonRequestSchema>;

// Narrow person shape used in event-people join responses (no authored profile fields).
export const EventPersonRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  relation: z.string().nullable(),
  channel: PersonChannelSchema.nullable()
});
export type EventPersonRow = z.infer<typeof EventPersonRowSchema>;

export const EventPeopleResponseSchema = z.object({
  event: EventRowSchema,
  people: z.array(EventPersonRowSchema)
});
export type EventPeopleResponse = z.infer<typeof EventPeopleResponseSchema>;

export const ReplaceEventPeopleRequestSchema = z.object({
  personIds: z.array(z.number().int().positive())
});
export type ReplaceEventPeopleRequest = z.infer<typeof ReplaceEventPeopleRequestSchema>;
