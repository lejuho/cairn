import type { FastifyInstance } from "fastify";
import { MapProviderSmokeDataSchema } from "@cairn/shared";
import type { MapGateway } from "../maps/gateway.js";

// Diagnostic/smoke route (cycle-72). No DB, no request body, no user-supplied
// address — calls the single map gateway with its fixed smoke query and maps the
// provider-neutral result/error to a stable API shape. NOT the Cycle 73
// on-demand geocoding API. Thin handler: gateway → map → respond.
export function registerMapRoutes(app: FastifyInstance, mapGateway: MapGateway): void {
  app.get("/api/maps/provider-smoke", async (_req, reply) => {
    const result = await mapGateway.smoke();
    if (result.ok) {
      return reply.send({ ok: true, data: MapProviderSmokeDataSchema.parse(result.data) });
    }
    // config_error = server misconfiguration; everything else = upstream/provider.
    const status = result.error.code === "config_error" ? 500 : 502;
    return reply.code(status).send({ ok: false, error: result.error });
  });
}
