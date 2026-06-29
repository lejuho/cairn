import { ItemListQuerySchema, ItemListResponseSchema } from "@cairn/shared";
import type { FastifyInstance } from "fastify";
import type { CairnDatabase } from "../db/index.js";
import { listItems } from "../services/items.js";

export function registerItemRoutes(app: FastifyInstance, db: CairnDatabase) {
  app.get("/api/items", async (req, reply) => {
    const parsed = ItemListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    return reply.send(ItemListResponseSchema.parse({ ok: true, data: listItems(db, parsed.data) }));
  });
}
