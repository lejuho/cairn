import { z } from "zod";
import { EventRowSchema } from "./events.js";

export const PersonChannelSchema = z.enum(["none", "kakao", "sms", "email", "telegram"]);
export type PersonChannel = z.infer<typeof PersonChannelSchema>;

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

export const PersonRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  relation: z.string().nullable(),
  channel: PersonChannelSchema.nullable(),
  hardConstraints: z.array(HardConstraintSchema).optional()
});
export type PersonRow = z.infer<typeof PersonRowSchema>;

export const ReplaceHardConstraintsRequestSchema = z.object({
  unavailableWeekdays: z.array(WeekdaySchema)
});
export type ReplaceHardConstraintsRequest = z.infer<typeof ReplaceHardConstraintsRequestSchema>;

export const CreatePersonRequestSchema = z.object({
  displayName: z.string().min(1),
  relation: z.string().optional(),
  channel: PersonChannelSchema
});
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
