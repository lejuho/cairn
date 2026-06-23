import type { FastifyInstance } from "fastify";
import { EgoGraphQuerySchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import {
  buildPersonEgoData,
  buildResourceEgoData,
  findPersonById,
  findResourceForEgo
} from "../repositories/relations.js";
import { buildEgoGraph } from "../services/ego-graph.js";

export function registerRelationRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/relations/ego", async (req, reply) => {
    const parsed = EgoGraphQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const { targetType, targetId, limit } = parsed.data;

    if (targetType === "resource") {
      const resource = findResourceForEgo(db, targetId);
      if (!resource) {
        return reply.code(404).send({
          ok: false,
          error: { code: "NOT_FOUND", message: `Resource ${targetId} not found` }
        });
      }

      const { neighbors, edges } = buildResourceEgoData(db, targetId, resource);
      const graph = buildEgoGraph({
        centerType: "resource",
        centerId: resource.id,
        centerLabel: resource.name,
        neighbors,
        edges,
        limit
      });

      return reply.send({ ok: true, data: graph });
    }

    // person center
    const person = findPersonById(db, targetId);
    if (!person) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `Person ${targetId} not found` }
      });
    }

    const { neighbors, edges } = buildPersonEgoData(db, person);
    const graph = buildEgoGraph({
      centerType: "person",
      centerId: person.id,
      centerLabel: person.name,
      centerHref: `/people/${person.id}`,
      neighbors,
      edges,
      limit
    });

    return reply.send({ ok: true, data: graph });
  });
}
