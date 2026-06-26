import type { FastifyInstance } from "fastify";
import { CreateThreadDraftRequestSchema } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { createThreadDraft } from "../services/threadDraft.js";

// Thread Draft A (cycle-51 FR-THR-02/03). LLM-backed; registered only when the
// gateway is present. Fails gracefully — never fabricates output.
export function registerThreadDraftRoutes(
  app: FastifyInstance,
  db: CairnDatabase,
  gateway: LlmGateway
): void {
  app.post("/api/threads/draft", async (req, reply) => {
    const parsed = CreateThreadDraftRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }
    const { text, now, timeZone } = parsed.data;
    const result = await createThreadDraft(db, gateway, {
      text,
      ...(now !== undefined ? { now } : {}),
      ...(timeZone !== undefined ? { timeZone } : {})
    });

    if (result.status === "ok") {
      return reply.code(201).send({ ok: true, data: result.data });
    }
    if (result.status === "llm_unavailable") {
      return reply.code(503).send({ ok: false, error: { code: "LLM_UNAVAILABLE", message: result.reason } });
    }
    if (result.status === "invalid_draft") {
      return reply.code(502).send({ ok: false, error: { code: "LLM_INVALID_DRAFT", message: result.reason } });
    }
    return reply.code(400).send({ ok: false, error: { code: "DB_ERROR", message: result.reason } });
  });
}
