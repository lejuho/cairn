import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AddNoteItemRequestSchema,
  CreateNoteRequestSchema,
  NoteListQuerySchema,
  NoteTargetQuerySchema,
  PatchNoteItemRequestSchema,
  PatchNoteRequestSchema
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { isRemoteAudience } from "../utils/audience.js";
import {
  addNoteItem,
  createNote,
  deleteNote,
  getNote,
  listNoteTargets,
  listNotes,
  updateNote,
  updateNoteItem,
  type NoteResult
} from "../services/notes.js";

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

function sendResult(reply: FastifyReply, result: NoteResult, status = 200) {
  if (!result.ok) {
    return result.code === "NOT_FOUND" ? notFound(reply, result.message) : validationError(reply, result.message);
  }
  return reply.code(status).send({ ok: true, data: { note: result.note } });
}

export function registerNoteRoutes(app: FastifyInstance, db: CairnDatabase): void {
  // 원격 커넥터는 메모를 새로 남기고(POST /api/notes) 공개 메모를 읽을 수만 있다.
  // 고치기·지우기·체크·대상 찾기는 원격 요청으로는 받지 않는다.
  app.addHook("preHandler", async (req, reply) => {
    if (!isRemoteAudience(req) || !req.url.startsWith("/api/notes")) return;
    const path = req.url.split("?")[0]!;
    const allowed = (req.method === "GET" && path !== "/api/notes/targets") || (req.method === "POST" && path === "/api/notes");
    if (!allowed) {
      return reply.code(403).send({ ok: false, error: { code: "FORBIDDEN", message: "not available to remote connectors" } });
    }
  });

  app.get("/api/notes", async (req, reply) => {
    const parsed = NoteListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: listNotes(db, parsed.data, { remoteOnly: isRemoteAudience(req) }) });
  });

  app.get("/api/notes/targets", async (req, reply) => {
    const parsed = NoteTargetQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return reply.send({ ok: true, data: { targets: listNoteTargets(db, parsed.data.q, parsed.data.limit) } });
  });

  app.post("/api/notes", async (req, reply) => {
    const parsed = CreateNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    // 원격 커넥터가 남긴 메모는 그쪽이 이미 내용을 알고 있으므로 공개로 저장한다.
    const input = isRemoteAudience(req) ? { ...parsed.data, remoteVisible: true } : parsed.data;
    return sendResult(reply, createNote(db, input), 201);
  });

  app.get("/api/notes/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const note = getNote(db, id);
    // 원격 요청에는 비공개 메모가 없는 것과 똑같이 보인다.
    if (!note || (isRemoteAudience(req) && !note.remoteVisible)) return notFound(reply, `note ${id} not found`);
    return reply.send({ ok: true, data: { note } });
  });

  app.patch("/api/notes/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const parsed = PatchNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return sendResult(reply, updateNote(db, id, parsed.data));
  });

  app.delete("/api/notes/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    if (!deleteNote(db, id)) return notFound(reply, `note ${id} not found`);
    return reply.send({ ok: true, data: { deleted: id } });
  });

  app.post("/api/notes/:id/items", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const parsed = AddNoteItemRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return sendResult(reply, addNoteItem(db, id, parsed.data.text), 201);
  });

  app.patch("/api/notes/:id/items/:itemId", async (req, reply) => {
    const params = req.params as Record<string, string>;
    const id = parseId(params.id);
    const itemId = parseId(params.itemId);
    if (!id || !itemId) return validationError(reply, "id and itemId must be positive integers");
    const parsed = PatchNoteItemRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    return sendResult(reply, updateNoteItem(db, id, itemId, parsed.data));
  });
}
