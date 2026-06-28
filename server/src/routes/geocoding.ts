import type { FastifyInstance } from "fastify";
import { EventGeocodeDataSchema, type MapErrorCode } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { MapGateway } from "../maps/gateway.js";
import { geocodeEvent } from "../services/geocoding.js";

// Event geocode route (cycle-73). No request body, no arbitrary address — only
// the target event's own `location` is geocoded. Thin handler: validate id,
// call the service, map its result to a stable HTTP shape.
export function registerGeocodingRoutes(app: FastifyInstance, db: CairnDatabase, mapGateway: MapGateway): void {
  app.post("/api/events/:id/geocode", async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }

    const result = await geocodeEvent(db, mapGateway, id);
    if (result.ok) {
      return reply.send({ ok: true, data: EventGeocodeDataSchema.parse(result.data) });
    }
    if (result.kind === "not_found") {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "Event not found" } });
    }
    if (result.kind === "location_missing") {
      return reply.code(409).send({ ok: false, error: { code: "LOCATION_MISSING", message: "Event has no location to geocode" } });
    }
    // map_error — scoped provider/config failure; no cache row was written.
    return reply.code(httpForMapError(result.code)).send({ ok: false, error: { code: result.code, message: result.message } });
  });
}

function httpForMapError(code: MapErrorCode): number {
  switch (code) {
    case "disabled":
    case "config_error":
    case "unavailable":
      return 503;
    case "rate_limited":
      return 429;
    case "denied":
    case "invalid_request":
    case "invalid_response":
      return 502;
    default:
      return 502;
  }
}
