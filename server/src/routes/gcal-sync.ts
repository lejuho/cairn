import type { FastifyInstance } from "fastify";
import { GcalSyncRunDataSchema, GcalSyncStatusDataSchema } from "@cairn/shared";
import {
  GcalSyncNotReadyError,
  getGcalSyncStatus,
  runGcalSyncNow,
  type GcalSyncControlOptions
} from "../services/gcal-sync-control.js";

export function registerGcalSyncRoutes(app: FastifyInstance, opts: GcalSyncControlOptions): void {
  let inFlight = false;

  app.get("/api/sync/gcal/status", async (_req, reply) => {
    const data = getGcalSyncStatus(opts);
    return reply.send({ ok: true, data: GcalSyncStatusDataSchema.parse(data) });
  });

  app.post("/api/sync/gcal/run", async (_req, reply) => {
    if (inFlight) {
      return reply.code(409).send({
        ok: false,
        error: { code: "GCAL_SYNC_IN_PROGRESS", message: "Google Calendar 동기화가 이미 실행 중이야." }
      });
    }

    inFlight = true;
    try {
      const data = await runGcalSyncNow(opts);
      return reply.send({ ok: true, data: GcalSyncRunDataSchema.parse(data) });
    } catch (err: unknown) {
      if (err instanceof GcalSyncNotReadyError) {
        return reply.code(409).send({
          ok: false,
          error: { code: "GCAL_NOT_READY", message: err.message, data: GcalSyncStatusDataSchema.parse(err.status) }
        });
      }
      return reply.code(502).send({
        ok: false,
        error: { code: "GCAL_SYNC_FAILED", message: "Google Calendar 동기화에 실패했어." }
      });
    } finally {
      inFlight = false;
    }
  });
}
