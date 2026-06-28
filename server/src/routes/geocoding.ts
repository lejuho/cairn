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
    const invalid = (message: string) => reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message } });

    // Strict id: the whole path segment must be a positive integer ("1abc" is
    // rejected, not silently parsed as 1) — cycle-73 review-v1 ISSUE-2.
    const idStr = (req.params as { id: string }).id;
    if (!/^\d+$/.test(idStr)) return invalid("id must be a positive integer");
    const id = Number(idStr);
    if (id <= 0) return invalid("id must be a positive integer");

    // No request body and no query parameters are accepted — the route geocodes
    // only the event's own location (no arbitrary address/query) — ISSUE-2.
    if (hasContent(req.body)) return invalid("this route accepts no request body");
    if (hasContent(req.query)) return invalid("this route accepts no query parameters");

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

// True when a body/query carries any content (non-empty object, or a non-object
// payload like a string/array). An absent body or `{}` query is allowed.
function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
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
