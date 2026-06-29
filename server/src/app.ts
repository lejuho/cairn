import { HealthResponseSchema } from "@cairn/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { CairnDatabase } from "./db/index.js";
import type { LlmGateway } from "./llm/gateway.js";
import type { MapGateway } from "./maps/gateway.js";
import { registerMapRoutes } from "./routes/maps.js";
import type { PlaceSearchGateway } from "./naver/place-search-gateway.js";
import { registerPlaceSearchRoutes } from "./routes/place-search.js";
import { createProviderStatusService } from "./services/provider-status.js";
import { registerProviderStatusRoutes } from "./routes/provider-status.js";
import { registerGeocodingRoutes } from "./routes/geocoding.js";
import { registerAnnotationRoutes } from "./routes/annotations.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerThreadDraftRoutes } from "./routes/threadDraft.js";
import { registerThreadStarDraftRoutes } from "./routes/threadStarDraft.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerFeasibilityRoutes } from "./routes/feasibility.js";
import { registerMirrorRoutes } from "./routes/mirror.js";
import { registerSlotRoutes } from "./routes/slots.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerTodayRoute } from "./routes/today.js";
import { registerWatcherRoutes } from "./routes/watchers.js";
import { registerRelationRoutes } from "./routes/relations.js";
import { registerTransitFactsRoutes } from "./routes/transit-facts.js";
import { registerResourceRoutes } from "./routes/resources.js";

export function buildServer(db?: CairnDatabase, gateway?: LlmGateway, mapGateway?: MapGateway, placeSearchGateway?: PlaceSearchGateway): FastifyInstance {
  const app = Fastify({
    logger: false
  });

  app.get("/health", async () =>
    HealthResponseSchema.parse({
      ok: true,
      data: {
        service: "cairn-server",
        status: "ok"
      }
    })
  );

  // Map provider boundary (cycle-72): registered without a DB — diagnostics only.
  if (mapGateway) {
    registerMapRoutes(app, mapGateway);
  }
  // Naver place-search boundary (cycle-79): registered without a DB — a read-only
  // provider boundary, no persistence.
  if (placeSearchGateway) {
    registerPlaceSearchRoutes(app, placeSearchGateway);
  }
  // Provider status badges (cycle-82): one TTL-cached diagnostic endpoint over the
  // existing map + place-search gateways. No DB — registered when both boundaries
  // exist so the badge row always reports both providers.
  if (mapGateway && placeSearchGateway) {
    const providerStatusService = createProviderStatusService({ mapGateway, placeSearchGateway });
    registerProviderStatusRoutes(app, providerStatusService);
  }

  if (db) {
    registerEventRoutes(app, db);
    registerPeopleRoutes(app, db);
    registerTaskRoutes(app, db);
    registerWatcherRoutes(app, db);
    // Today + feasibility take the optional map gateway for cache-only travel
    // evidence (cycle-76). Absent gateway / disabled provider → unavailable
    // evidence; the surfaces still return 200.
    registerTodayRoute(app, db, mapGateway);
    registerThreadRoutes(app, db);
    registerSlotRoutes(app, db);
    registerFeasibilityRoutes(app, db, mapGateway);
    registerDecisionRoutes(app, db);
    registerMirrorRoutes(app, db);
    registerResourceRoutes(app, db);
    registerRelationRoutes(app, db);
    registerTransitFactsRoutes(app, db);
    // Event geocoding (cycle-73): needs both DB (cache) and the map gateway.
    if (mapGateway) {
      registerGeocodingRoutes(app, db, mapGateway);
    }
    if (gateway) {
      registerAnnotationRoutes(app, db, gateway);
      registerCaptureRoutes(app, db, gateway);
      registerThreadDraftRoutes(app, db, gateway);
      registerThreadStarDraftRoutes(app, db, gateway);
    }
  }

  return app;
}
