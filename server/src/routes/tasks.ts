import type { FastifyInstance } from "fastify";
import { CreateTaskRequestSchema, DismissTaskSchedulePromptRequestSchema, PatchTaskStatusRequestSchema, PatchThreadTaskNodeRequestSchema, SlotCandidatesQuerySchema } from "@cairn/shared";
import { createTask, dismissTaskSchedulePromptForDate, findTaskById, isTaskPromptEligible, updateTaskStatus, updateTaskThreadNode } from "../repositories/tasks.js";
import { generateTaskSlotCandidates } from "../services/slotCandidates.js";
import type { CairnDatabase } from "../db/index.js";

export function registerTaskRoutes(app: FastifyInstance, db: CairnDatabase): void {
  app.post("/api/tasks", async (req, reply) => {
    const parsed = CreateTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    try {
      const task = createTask(db, parsed.data);
      return reply.code(201).send({ ok: true, data: task });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({
        ok: false,
        error: { code: "DB_ERROR", message: msg }
      });
    }
  });

  app.patch("/api/tasks/:id/status", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" }
      });
    }

    const parsed = PatchTaskStatusRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: parsed.error.message }
      });
    }

    const task = updateTaskStatus(db, id, parsed.data.status);
    if (!task) {
      return reply.code(404).send({
        ok: false,
        error: { code: "NOT_FOUND", message: `task ${id} not found` }
      });
    }

    return reply.send({ ok: true, data: task });
  });

  // Thread node inline edit (cycle-50 FR-THR-06). Edits only title/estMinutes/
  // due/context/optional. status/threadId are not editable here.
  app.patch("/api/tasks/:id/thread-node", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = PatchThreadTaskNodeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    if (!findTaskById(db, id)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: `task ${id} not found` } });
    }
    const updated = updateTaskThreadNode(db, id, parsed.data)!;
    return reply.send({ ok: true, data: { task: updated } });
  });

  // Read-only due-task slot preview (cycle-62 FR-SLOT-06C). Builds candidates
  // from the task's own est_minutes as duration; NO DB write, no event created.
  // 404 unknown task; 409 when the task is not a due-imminent prompt-eligible
  // task (done/dropped, no estimate, invalid/too-far due date).
  app.get("/api/tasks/:id/slot-candidates", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const q = SlotCandidatesQuerySchema.safeParse(req.query);
    if (!q.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: q.error.message } });
    }
    const task = findTaskById(db, id);
    if (!task) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: `task ${id} not found` } });
    }
    if (!isTaskPromptEligible(task, q.data.date)) {
      return reply.code(409).send({ ok: false, error: { code: "TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE", message: "task is not a due-imminent schedule prompt" } });
    }
    const candidates = generateTaskSlotCandidates(
      db,
      { threadId: task.threadId, estMinutes: task.estMinutes! },
      q.data.now,
      q.data.date,
      q.data.days
    );
    return reply.send({ ok: true, data: { task, candidates } });
  });

  // Dismiss a due-task schedule prompt for one Today date (cycle-62). Writes
  // only schedule_prompt_dismissed_on. 404 unknown; 409 ineligible; idempotent.
  app.patch("/api/tasks/:id/schedule-prompt/dismiss", async (req, reply) => {
    const id = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id must be a positive integer" } });
    }
    const parsed = DismissTaskSchedulePromptRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error.message } });
    }
    if (!findTaskById(db, id)) {
      return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: `task ${id} not found` } });
    }
    const dismissed = dismissTaskSchedulePromptForDate(db, id, parsed.data.dismissedOn);
    if (!dismissed) {
      return reply.code(409).send({ ok: false, error: { code: "TASK_SCHEDULE_PROMPT_NOT_ELIGIBLE", message: "task is not an eligible schedule prompt" } });
    }
    return reply.send({ ok: true, data: { taskId: id, dismissedOn: parsed.data.dismissedOn } });
  });
}
