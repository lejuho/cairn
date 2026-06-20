import { z } from "zod";
import { PersonChannelSchema } from "./people.js";

export const NotificationLeadTimeStatusSchema = z.enum(["enough", "late", "unknown"]);
export type NotificationLeadTimeStatus = z.infer<typeof NotificationLeadTimeStatusSchema>;

export const NotificationReasonCodeSchema = z.enum([
  "channel_unset",
  "lead_time_unset",
  "lead_time_late",
  "event_time_unknown",
  "tone_profile_unavailable"
]);
export type NotificationReasonCode = z.infer<typeof NotificationReasonCodeSchema>;

export const NotificationDraftSchema = z.object({
  personId: z.number().int().positive(),
  personName: z.string(),
  channel: PersonChannelSchema.nullable(),
  leadTimeDays: z.number().int().min(0).max(30).nullable(),
  leadTimeStatus: NotificationLeadTimeStatusSchema,
  tone: z.literal("neutral"),
  message: z.string().min(1),
  reasonCodes: z.array(NotificationReasonCodeSchema)
});
export type NotificationDraft = z.infer<typeof NotificationDraftSchema>;
