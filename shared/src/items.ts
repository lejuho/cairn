import { z } from "zod";
import { EventRowSchema } from "./events.js";
import { TaskRowSchema } from "./tasks.js";

export const ItemListScopeSchema = z.enum(["active", "all"]);

export const ItemListQuerySchema = z
  .object({
    scope: ItemListScopeSchema.default("active"),
    limit: z.coerce.number().int().min(1).max(200).default(100)
  })
  .strict();

export const ItemListDataSchema = z
  .object({
    scope: ItemListScopeSchema,
    events: z.array(EventRowSchema),
    tasks: z.array(TaskRowSchema)
  })
  .strict();

export const ItemListResponseSchema = z
  .object({
    ok: z.literal(true),
    data: ItemListDataSchema
  })
  .strict();

export type ItemListScope = z.infer<typeof ItemListScopeSchema>;
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;
export type ItemListData = z.infer<typeof ItemListDataSchema>;
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
