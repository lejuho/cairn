import { HealthResponseSchema } from "@cairn/shared";
import Fastify, { type FastifyInstance } from "fastify";

export function buildServer(): FastifyInstance {
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

  return app;
}
