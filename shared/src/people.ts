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
  // 묶음(소속·모임) 이름들. 목록에서 고르고 걸러 보는 데 쓴다. relation 은 자유롭게 쓰는 설명이다.
  groups: z.array(z.string()).optional(),
  // 정하지 않았으면 null.
  gender: z.enum(["male", "female"]).nullable().optional(),
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

export const PersonGenderSchema = z.enum(["male", "female"]);
export type PersonGender = z.infer<typeof PersonGenderSchema>;

const personGroups = z.array(z.string().trim().min(1).max(40)).max(12);

export const CreatePersonRequestSchema = z.object({
  displayName: z.string().min(1),
  relation: z.string().optional(),
  channel: PersonChannelSchema,
  groups: personGroups.optional(),
  gender: PersonGenderSchema.nullable().optional()
});

// 이름·설명·연락 채널·묶음 고치기. 바꿀 것만 보낸다.
export const PatchPersonRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    relation: z.string().trim().max(500).nullable().optional(),
    channel: PersonChannelSchema.optional(),
    groups: personGroups.optional(),
    gender: PersonGenderSchema.nullable().optional(),
    pinned: z.boolean().optional()
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nothing to change" });
export type PatchPersonRequest = z.infer<typeof PatchPersonRequestSchema>;

export type PersonGroupCount = { name: string; count: number };
export type CreatePersonRequest = z.infer<typeof CreatePersonRequestSchema>;

export const EventPeopleResponseSchema = z.object({
  event: EventRowSchema,
  people: z.array(PersonRowSchema)
});
export type EventPeopleResponse = z.infer<typeof EventPeopleResponseSchema>;

export const ReplaceEventPeopleRequestSchema = z.object({
  personIds: z.array(z.number().int().positive())
});
export type ReplaceEventPeopleRequest = z.infer<typeof ReplaceEventPeopleRequestSchema>;
