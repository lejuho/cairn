import { z } from "zod";

export const GCAL_SYNC_STATES = ["connected", "needs_config", "needs_auth"] as const;
export const GcalSyncStateSchema = z.enum(GCAL_SYNC_STATES);

export const GcalSyncResultSchema = z
  .object({
    upserted: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative()
  })
  .strict();

export const GcalSyncStatusDataSchema = z
  .object({
    state: GcalSyncStateSchema,
    configured: z.boolean(),
    tokenPresent: z.boolean(),
    syncTokenPresent: z.boolean(),
    lastSyncAt: z.string().datetime({ offset: true }).nullable(),
    tokenPath: z.string().nullable(),
    message: z.string().max(160)
  })
  .strict();

export const GcalSyncStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    data: GcalSyncStatusDataSchema
  })
  .strict();

export const GcalSyncRunDataSchema = z
  .object({
    status: GcalSyncStatusDataSchema,
    result: GcalSyncResultSchema
  })
  .strict();

export const GcalSyncRunResponseSchema = z
  .object({
    ok: z.literal(true),
    data: GcalSyncRunDataSchema
  })
  .strict();

export type GcalSyncState = z.infer<typeof GcalSyncStateSchema>;
export type GcalSyncResult = z.infer<typeof GcalSyncResultSchema>;
export type GcalSyncStatusData = z.infer<typeof GcalSyncStatusDataSchema>;
export type GcalSyncStatusResponse = z.infer<typeof GcalSyncStatusResponseSchema>;
export type GcalSyncRunData = z.infer<typeof GcalSyncRunDataSchema>;
export type GcalSyncRunResponse = z.infer<typeof GcalSyncRunResponseSchema>;
