import type { FastifyInstance } from "fastify";
import { ProviderStatusDataSchema } from "@cairn/shared";
import type { ProviderStatusService } from "../services/provider-status.js";

// Provider Status Badges A (cycle-82). Thin diagnostic handler: no body/query.
// Delegates to the TTL-cached service and returns provider-neutral rows. Always
// `ok:true` — a degraded provider is a row state, not a failed response, so the
// badge surface never breaks navigation.
export function registerProviderStatusRoutes(app: FastifyInstance, service: ProviderStatusService): void {
  app.get("/api/providers/status", async (_req, reply) => {
    const providers = await service.getStatus();
    return reply.send({ ok: true, data: ProviderStatusDataSchema.parse({ providers }) });
  });
}
