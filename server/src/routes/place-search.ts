import type { FastifyInstance } from "fastify";
import { PlaceSearchQuerySchema, type PlaceSearchErrorCode } from "@cairn/shared";
import type { PlaceSearchGateway } from "../naver/place-search-gateway.js";

// Naver place-search route (cycle-79). NO DB, NO write — a thin provider
// boundary: validate the query, call the server-side gateway, map the typed
// result to a stable HTTP shape. Credentials never appear here.
export function registerPlaceSearchRoutes(app: FastifyInstance, gateway: PlaceSearchGateway): void {
  app.get("/api/places/naver", async (req, reply) => {
    const parsed = PlaceSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "validation_error", message: parsed.error.message } });
    }
    const result = await gateway.search(parsed.data.query);
    if (result.ok) {
      return reply.send({ ok: true, data: { provider: "naver", candidates: result.candidates } });
    }
    return reply.code(httpForError(result.error.code)).send({ ok: false, error: result.error });
  });
}

function httpForError(code: PlaceSearchErrorCode): number {
  switch (code) {
    case "disabled":
    case "unavailable":
      return 503;
    case "rate_limited":
      return 429;
    case "denied":
    case "invalid_response":
      return 502;
    case "validation_error":
      return 400;
    default:
      return 502;
  }
}
