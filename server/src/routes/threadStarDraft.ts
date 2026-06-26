import type { FastifyInstance } from "fastify";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { generateThreadStarDraft } from "../services/threadStarDraft.js";

// Thread STAR Draft A (cycle-55 FR-CV-01). LLM-backed; registered only when the
// gateway is present. No request body; no DB write. Fails gracefully.
export function registerThreadStarDraftRoutes(
  app: FastifyInstance,
  db: CairnDatabase,
  gateway: LlmGateway
): void {
  app.post("/api/threads/:id/star-draft", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const result = await generateThreadStarDraft(db, gateway, id);

    if (result.status === "ok") {
      return reply.code(200).send({ ok: true, data: result.data });
    }
    if (result.status === "not_found") {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "thread not found" } });
    }
    if (result.status === "not_done") {
      return reply.code(409).send({ ok: false, error: { code: "THREAD_NOT_DONE", message: "thread is not complete" } });
    }
    if (result.status === "llm_unavailable") {
      return reply.code(503).send({ ok: false, error: { code: "LLM_UNAVAILABLE", message: result.reason } });
    }
    return reply.code(502).send({ ok: false, error: { code: "LLM_INVALID_DRAFT", message: result.reason } });
  });
}
