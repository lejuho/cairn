import type { FastifyInstance } from "fastify";
import { MirrorLedgerQuerySchema } from "@cairn/shared";
import { findMovedCancelledAnnotations } from "../repositories/mirror.js";
import { buildMirrorLedger } from "../services/mirror-ledger.js";
import type { CairnDatabase } from "../db/index.js";

export function registerMirrorRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.get("/api/mirror/ledger", async (req, reply) => {
    const parsed = MirrorLedgerQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const rows = findMovedCancelledAnnotations(db);
    const data = buildMirrorLedger(rows, {
      from: parsed.data.from,
      to: parsed.data.to,
      today: serverLocalToday()
    });
    return reply.send({ ok: true, data });
  });
}

// Server-local calendar date. Date.now boundary stays at the route edge so the
// service remains pure/deterministic.
function serverLocalToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
