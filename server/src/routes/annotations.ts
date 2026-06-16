import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AnnotationIntakeRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { findEventById } from "../repositories/events.js";
import { intakeAnnotation } from "../services/annotationIntake.js";

const IdParamSchema = z.coerce.number().int().positive();

export function registerAnnotationRoutes(
  app: FastifyInstance,
  db: CairnDatabase,
  gateway: LlmGateway
): void {
  app.post("/api/events/:id/annotations", async (req, reply) => {
    const idParsed = IdParamSchema.safeParse(
      (req.params as Record<string, unknown>).id
    );
    if (!idParsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const bodyParsed = AnnotationIntakeRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: bodyParsed.error.message }
      });
    }

    const eventId = idParsed.data;
    const event = findEventById(db, eventId);
    if (!event) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `Event ${eventId} not found` }
      });
    }

    const result = await intakeAnnotation(db, gateway, eventId, bodyParsed.data.text);
    return reply.code(201).send({ ok: true, data: result });
  });
}
