import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { FrequencyBandSchema, PersonRowSchema } from "./people.js";

export const PersonDirectoryQuerySchema = z.object({
  now: z.string().datetime({ offset: true })
});
export type PersonDirectoryQuery = z.infer<typeof PersonDirectoryQuerySchema>;

export const PersonDetailQuerySchema = z.object({
  now: z.string().datetime({ offset: true })
});
export type PersonDetailQuery = z.infer<typeof PersonDetailQuerySchema>;

export const PersonDirectoryRowSchema = PersonRowSchema.extend({
  totalMeets: z.number(),
  lastMet: z.string().nullable(),
  frequencyBand: FrequencyBandSchema
});
export type PersonDirectoryRow = z.infer<typeof PersonDirectoryRowSchema>;

export const PersonDirectoryResponseSchema = z.object({
  people: z.array(PersonDirectoryRowSchema)
});
export type PersonDirectoryResponse = z.infer<typeof PersonDirectoryResponseSchema>;

export const PersonDetailResponseSchema = z.object({
  person: PersonDirectoryRowSchema,
  recentMeetings: z.array(EventRowSchema)
});
export type PersonDetailResponse = z.infer<typeof PersonDetailResponseSchema>;
