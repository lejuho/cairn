import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AddNoteItemRequestSchema,
  CreateEventFromNoteRequestSchema,
  CreateNoteRequestSchema,
  CreateTaskFromNoteItemRequestSchema,
  EventDraftFromTextRequestSchema,
  NoteListQuerySchema,
  NoteTargetQuerySchema,
  PatchNoteItemRequestSchema,
  PatchNoteRequestSchema,
  type NoteEventDraftData
} from "@cairn/shared";
import type { LlmGateway } from "../llm/gateway.js";
import { addMinutesToRfc3339, parseFlatEvent } from "../llm/flatEventParser.js";
import type { CairnDatabase } from "../db/index.js";
import { isRemoteAudience } from "../utils/audience.js";
import {
  addNoteItem,
  createEventFromNote,
  createNote,
  createTaskFromNoteItem,
  noteHeadline,
  noteTextForParsing,
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

export function registerNoteRoutes(app: FastifyInstance, db: CairnDatabase, gateway?: LlmGateway): void {
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

  // 글 → 일정 초안. 아무것도 저장하지 않는다. AI 가 없거나 날짜를 못 읽어도 제목은 채워서 돌려주고,
  // 날짜는 사용자가 고르게 둔다 (제안은 확인 없이 반영되지 않는다).
  const draftEvent = async (text: string, headline: string): Promise<NoteEventDraftData> => {
    const fallback: NoteEventDraftData = { title: headline, start: null, end: null, parseStatus: "unparsed" };
    if (!gateway) return { ...fallback, llmError: "LLM gateway not configured" };
    if (!text) return fallback;
    try {
      const timeZone = process.env.CAIRN_TIME_ZONE?.trim() || "Asia/Seoul";
      const parsed = await parseFlatEvent(gateway, text, new Date().toISOString().replace("Z", "+00:00"), timeZone);
      if (parsed.data === null) return { ...fallback, llmError: parsed.error };
      const start = parsed.data.start ?? null;
      return {
        title: parsed.data.title.slice(0, 200),
        start,
        end: start ? addMinutesToRfc3339(start, 60) : null,
        parseStatus: start ? "parsed" : "unparsed"
      };
    } catch (e) {
      return { ...fallback, llmError: e instanceof Error ? e.message : "parser error" };
    }
  };

  // 아직 저장하지 않은 글에서 (빠른 기록).
  app.post("/api/notes/event-draft", async (req, reply) => {
    const parsed = EventDraftFromTextRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const text = parsed.data.text;
    const headline = (text.split("\n").map((line) => line.trim()).find(Boolean) ?? "일정").slice(0, 200);
    return reply.send({ ok: true, data: await draftEvent(text, headline) });
  });

  // 저장된 메모에서.
  app.post("/api/notes/:id/event-draft", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const note = getNote(db, id);
    if (!note) return notFound(reply, `note ${id} not found`);
    return reply.send({ ok: true, data: await draftEvent(noteTextForParsing(note), noteHeadline(note)) });
  });

  app.post("/api/notes/:id/event", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    if (!id) return validationError(reply, "id must be a positive integer");
    const parsed = CreateEventFromNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) return validationError(reply, parsed.error.message);
    const result = createEventFromNote(db, id, parsed.data);
    if (!result.ok) return notFound(reply, result.message);
    return reply.code(201).send({ ok: true, data: { note: result.note, eventId: result.eventId } });
  });

  app.post("/api/notes/:id/items/:itemId/task", async (req, reply) => {
    const params = req.params as Record<string, string>;
    const id = parseId(params.id);
    const itemId = parseId(params.itemId);
    if (!id || !itemId) return validationError(reply, "id and itemId must be positive integers");
    const body = CreateTaskFromNoteItemRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return validationError(reply, body.error.message);
    const result = createTaskFromNoteItem(db, id, itemId, body.data.estMinutes);
    if (!result.ok) return notFound(reply, result.message);
    return reply.code(201).send({ ok: true, data: { note: result.note, taskId: result.taskId } });
  });
}
