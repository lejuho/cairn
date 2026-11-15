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

// 사람과 걸린 일정 하나 (목록에서 "언제 무슨 일로 보는지"를 보여주는 데 쓴다).
export const PersonEventRefSchema = z.object({ eventId: z.number(), title: z.string(), start: z.string() });
export type PersonEventRef = z.infer<typeof PersonEventRefSchema>;

export const PersonDirectoryRowSchema = PersonRowSchema.extend({
  totalMeets: z.number(),
  lastMet: z.string().nullable(),
  frequencyBand: FrequencyBandSchema
  ,
  // 앞으로 30일 안에 이 사람과 잡힌 가장 가까운 일정, 지난 30일 안에 있었던 가장 최근 일정.
  upcoming: PersonEventRefSchema.nullable().optional(),
  recent: PersonEventRefSchema.nullable().optional(),
  // 사용자가 따로 모아둔 사람인가.
  pinned: z.boolean().optional()
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
