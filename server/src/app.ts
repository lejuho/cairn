import { HealthResponseSchema } from "@cairn/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { CairnDatabase } from "./db/index.js";
import type { LlmGateway } from "./llm/gateway.js";
import { registerAnnotationRoutes } from "./routes/annotations.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerFeasibilityRoutes } from "./routes/feasibility.js";
import { registerSlotRoutes } from "./routes/slots.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerThreadRoutes } from "./routes/threads.js";
import { registerTodayRoute } from "./routes/today.js";
import { registerWatcherRoutes } from "./routes/watchers.js";

export function buildServer(db?: CairnDatabase, gateway?: LlmGateway): FastifyInstance {
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

  if (db) {
    registerEventRoutes(app, db);
    registerPeopleRoutes(app, db);
    registerTaskRoutes(app, db);
    registerWatcherRoutes(app, db);
    registerTodayRoute(app, db);
    registerThreadRoutes(app, db);
    registerSlotRoutes(app, db);
    registerFeasibilityRoutes(app, db);
    if (gateway) {
      registerAnnotationRoutes(app, db, gateway);
      registerCaptureRoutes(app, db, gateway);
    }
  }

  return app;
}
