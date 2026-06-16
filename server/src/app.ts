import { HealthResponseSchema } from "@cairn/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { CairnDatabase } from "./db/index.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerTodayRoute } from "./routes/today.js";
import { registerWatcherRoutes } from "./routes/watchers.js";

export function buildServer(db?: CairnDatabase): FastifyInstance {
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
    registerTaskRoutes(app, db);
    registerWatcherRoutes(app, db);
    registerTodayRoute(app, db);
  }

  return app;
}
