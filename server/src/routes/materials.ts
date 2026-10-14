import type { FastifyInstance, FastifyReply } from "fastify";
import { CreateEventMaterialRequestSchema, PatchEventMaterialRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { createEventMaterial, getCaptureCheck, listEventMaterials, updateEventMaterial } from "../services/event-materials.js";

function validationError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message } });
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message } });
}

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerMaterialRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/events/:id/materials", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const check = getCaptureCheck(db, id);
    if (!check) return notFound(reply, `event ${id} not found`);
    return reply.send({ ok: true, data: { materials: listEventMaterials(db, id) } });
  });

  app.post("/api/events/:id/materials", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const parsed = CreateEventMaterialRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const material = createEventMaterial(db, id, parsed.data);
    if (!material) return notFound(reply, `event ${id} not found`);
    return reply.code(201).send({ ok: true, data: { material } });
  });

  app.get("/api/events/:id/capture-check", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const check = getCaptureCheck(db, id);
    if (!check) return notFound(reply, `event ${id} not found`);
    return reply.send({ ok: true, data: check });
  });

  app.patch("/api/materials/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const parsed = PatchEventMaterialRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const result = updateEventMaterial(db, id, parsed.data);
    if (!result.ok) {
      return result.code === "NOT_FOUND" ? notFound(reply, result.message) : validationError(reply, result.message);
    }
    return reply.send({ ok: true, data: { material: result.material } });
  });
}
