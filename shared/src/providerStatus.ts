import { z } from "zod";

// Provider Status Badges A (cycle-82). A small, diagnostic, server-owned signal
// answering "is this provider connected right now?". It is NOT a monitoring
// dashboard and never carries secrets, upstream URLs, raw provider payloads, or
// provider error bodies — only a provider-neutral code + static user-safe copy.

export const PROVIDER_STATUS_IDS = ["google", "naver"] as const;
export const ProviderStatusIdSchema = z.enum(PROVIDER_STATUS_IDS);

// connected = reachable/usable; disabled = intentionally off (not an error);
// degraded = configured but currently denied/limited/unavailable/misconfigured.
export const PROVIDER_STATUS_STATES = ["connected", "disabled", "degraded"] as const;
export const ProviderStatusStateSchema = z.enum(PROVIDER_STATUS_STATES);

// Provider-neutral codes. No provider-specific status string is ever surfaced.
export const PROVIDER_STATUS_CODES = [
  "ok",
  "disabled",
  "denied",
  "rate_limited",
  "unavailable",
  "invalid_response",
  "config_error"
] as const;
export const ProviderStatusCodeSchema = z.enum(PROVIDER_STATUS_CODES);

export const ProviderStatusRowSchema = z
  .object({
    id: ProviderStatusIdSchema,
    label: z.string(),
    state: ProviderStatusStateSchema,
    code: ProviderStatusCodeSchema,
    checkedAt: z.string().datetime({ offset: true }),
    ttlSeconds: z.number().int().positive(),
    message: z.string().max(120)
  })
  .strict();

export const ProviderStatusDataSchema = z
  .object({
    providers: z.array(ProviderStatusRowSchema)
  })
  .strict();

// Success-only: provider failures are reported as `degraded` rows, never as a
// failed HTTP response — the badge surface must not break primary navigation.
export const ProviderStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    data: ProviderStatusDataSchema
  })
  .strict();

export type ProviderStatusId = z.infer<typeof ProviderStatusIdSchema>;
export type ProviderStatusState = z.infer<typeof ProviderStatusStateSchema>;
export type ProviderStatusCode = z.infer<typeof ProviderStatusCodeSchema>;
export type ProviderStatusRow = z.infer<typeof ProviderStatusRowSchema>;
export type ProviderStatusData = z.infer<typeof ProviderStatusDataSchema>;
export type ProviderStatusResponse = z.infer<typeof ProviderStatusResponseSchema>;
