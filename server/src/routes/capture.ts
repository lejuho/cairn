import type { FastifyInstance } from "fastify";
import { FlatCaptureRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { captureFlat } from "../services/flatCapture.js";

export function registerCaptureRoutes(
  app: FastifyInstance,
  db: CairnDatabase,
  gateway: LlmGateway
): void {
  app.post("/api/capture/flat-event", async (req, reply) => {
    const parsed = FlatCaptureRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const { text, now, timeZone } = parsed.data;
    const data = await captureFlat(db, gateway, {
      text,
      ...(now !== undefined ? { now } : {}),
      ...(timeZone !== undefined ? { timeZone } : {})
    });
    return reply.code(201).send({ ok: true, data });
  });
}
