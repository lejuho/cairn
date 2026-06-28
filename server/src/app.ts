import { HealthResponseSchema } from "@cairn/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { CairnDatabase } from "./db/index.js";
import type { LlmGateway } from "./llm/gateway.js";
import type { MapGateway } from "./maps/gateway.js";
import { registerMapRoutes } from "./routes/maps.js";
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
import { registerResourceRoutes } from "./routes/resources.js";

export function buildServer(db?: CairnDatabase, gateway?: LlmGateway, mapGateway?: MapGateway): FastifyInstance {
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

  if (db) {
    registerEventRoutes(app, db);
    registerPeopleRoutes(app, db);
    registerTaskRoutes(app, db);
    registerWatcherRoutes(app, db);
    registerTodayRoute(app, db);
    registerThreadRoutes(app, db);
    registerSlotRoutes(app, db);
    registerFeasibilityRoutes(app, db);
    registerDecisionRoutes(app, db);
    registerMirrorRoutes(app, db);
    registerResourceRoutes(app, db);
    registerRelationRoutes(app, db);
    if (gateway) {
      registerAnnotationRoutes(app, db, gateway);
      registerCaptureRoutes(app, db, gateway);
      registerThreadDraftRoutes(app, db, gateway);
      registerThreadStarDraftRoutes(app, db, gateway);
    }
  }

  return app;
}
