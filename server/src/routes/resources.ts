import type { FastifyInstance } from "fastify";
import { CreateResourceLinkRequestSchema, CreateResourceRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  createResource,
  createResourceLinkIdempotent,
  eventExists,
  findResourceById,
  findThreadResourceFocus,
  listResources,
  personExists,
  taskExists,
  threadExists
} from "../repositories/resources.js";

export function registerResourceRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/resources", async (req, reply) => {
    const parsed = CreateResourceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const { name, kind, sourcePersonId, note } = parsed.data;

    if (sourcePersonId != null && !personExists(db, sourcePersonId)) {
      return reply.code(404).send({
        ok: false,
        error: { code: "SOURCE_PERSON_NOT_FOUND", message: "source person not found" }
      });
    }

    const resource = createResource(db, { name, kind, sourcePersonId: sourcePersonId ?? null, note: note ?? null });
    return reply.code(201).send({ ok: true, data: { resource } });
  });

  app.get("/api/resources", async (_req, reply) => {
    const all = listResources(db);
    return reply.send({ ok: true, data: { resources: all } });
  });

  app.post("/api/resources/:id/links", async (req, reply) => {
    const rawId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(rawId) || rawId <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const parsed = CreateResourceLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const resource = findResourceById(db, rawId);
    if (!resource) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "resource not found" }
      });
    }

    const { targetType, targetId, firmness, reason } = parsed.data;

    const targetFound =
      targetType === "event"
        ? eventExists(db, targetId)
        : targetType === "task"
          ? taskExists(db, targetId)
          : threadExists(db, targetId);

    if (!targetFound) {
      return reply.code(404).send({
        ok: false,
        error: { code: "TARGET_NOT_FOUND", message: `${targetType} with id ${targetId} not found` }
      });
    }

    const linkRow = createResourceLinkIdempotent(db, {
      resourceId: rawId,
      targetType,
      targetId,
      firmness,
      reason: reason ?? null
    });

    return reply.code(201).send({
      ok: true,
      data: {
        link: {
          id: linkRow.id,
          resourceId: linkRow.resourceId,
          targetType: linkRow.targetType,
          targetId: linkRow.targetId,
          firmness: linkRow.firmness,
          reason: linkRow.reason ?? null,
          createdAt: linkRow.createdAt ?? null
        }
      }
    });
  });

  app.get("/api/threads/:id/resource-focus", async (req, reply) => {
    const rawId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(rawId) || rawId <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    if (!threadExists(db, rawId)) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: "thread not found" }
      });
    }

    const data = findThreadResourceFocus(db, rawId);
    return reply.send({ ok: true, data });
  });
}
