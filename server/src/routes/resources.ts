import type { FastifyInstance } from "fastify";
import { ApprovePromotionRequestSchema, CreateResourceLinkRequestSchema, CreateResourceRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  approvePromotion,
  createResource,
  createResourceLinkIdempotent,
  eventExists,
  findAllResourceLinksForSuppression,
  findCandidateSources,
  findResourceById,
  findThreadResourceFocus,
  listResources,
  personExists,
  taskExists,
  threadExists
} from "../repositories/resources.js";
import {
  buildPromotionSuggestions,
  checkPromotionStaleness
} from "../services/resource-promotions.js";

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

  app.get("/api/resources/promotion-suggestions", async (req, reply) => {
    const rawThreadId = (req.query as { threadId?: string }).threadId;
    let threadId: number | undefined;
    if (rawThreadId != null) {
      threadId = Number(rawThreadId);
      if (!Number.isInteger(threadId) || threadId <= 0) {
        return reply.code(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "threadId must be a positive integer" }
        });
      }
      if (!threadExists(db, threadId)) {
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: "thread not found" }
        });
      }
    }

    const nodes = findCandidateSources(db, threadId);
    const existingLinks = findAllResourceLinksForSuppression(db);
    const suggestions = buildPromotionSuggestions(nodes, existingLinks);

    return reply.send({ ok: true, data: { suggestions } });
  });

  app.post("/api/resources/promotion-suggestions/approve", async (req, reply) => {
    const parsed = ApprovePromotionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { candidateKey, name, kind, occurrences, threadId: approveThreadId, sourcePersonId, note } = parsed.data;

    if (sourcePersonId != null && !personExists(db, sourcePersonId)) {
      return reply.code(404).send({
        ok: false,
        error: { code: "SOURCE_PERSON_NOT_FOUND", message: "source person not found" }
      });
    }

    // Recompute suggestions scoped to the same threadId used when fetching.
    // Advisory scope — no 404 on missing threadId (occurrences are validated below).
    const nodes = findCandidateSources(db, approveThreadId);
    const existingLinks = findAllResourceLinksForSuppression(db);
    const recomputed = buildPromotionSuggestions(nodes, existingLinks);

    const staleError = checkPromotionStaleness({ candidateKey, name, kind, occurrences }, recomputed);
    if (staleError === "PROMOTION_NOT_ELIGIBLE") {
      return reply.code(409).send({
        ok: false,
        error: { code: "PROMOTION_NOT_ELIGIBLE", message: "candidate is no longer eligible (fewer than 2 distinct nodes)" }
      });
    }
    if (staleError === "PROMOTION_STALE") {
      return reply.code(409).send({
        ok: false,
        error: { code: "PROMOTION_STALE", message: "candidate key no longer matches current suggestions" }
      });
    }

    // Validate all occurrence targets exist.
    for (const occ of occurrences) {
      const exists =
        occ.targetType === "event"
          ? eventExists(db, occ.targetId)
          : occ.targetType === "task"
            ? taskExists(db, occ.targetId)
            : threadExists(db, occ.targetId);
      if (!exists) {
        return reply.code(400).send({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: `${occ.targetType} ${occ.targetId} not found` }
        });
      }
    }

    const result = approvePromotion(db, {
      name,
      kind,
      occurrences,
      sourcePersonId: sourcePersonId ?? null,
      note: note ?? null
    });

    return reply.code(201).send({ ok: true, data: result });
  });
}
