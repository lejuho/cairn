import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { AddNoteLinkRequestSchema, NOTE_FILE_MAX_BYTES } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { attachFile, attachLink, detachAttachment, findFile, isInlineType } from "../services/files.js";
import { getNote } from "../services/notes.js";
import { isRemoteAudience } from "../utils/audience.js";

// Attachments of a note. Uploads arrive as the raw bytes of one file (application/octet-stream)
// with the file's name in a header, so no multipart parser is needed.

function parseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function headerText(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function registerFileRoutes(app: FastifyInstance, db: CairnDatabase): void {
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: NOTE_FILE_MAX_BYTES }, (_req, body, done) => done(null, body));
  }

  const notFound = { ok: false, error: { code: "NOT_FOUND", message: "메모를 찾을 수 없습니다" } };

  // Remote connectors never change attachments (the notes guard covers /api/notes/*).
  app.post("/api/notes/:id/files", { bodyLimit: NOTE_FILE_MAX_BYTES }, async (req, reply) => {
    const noteId = parseId((req.params as Record<string, string>).id);
    const bytes = req.body;
    if (!noteId) return reply.code(404).send(notFound);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "파일 내용이 없습니다" } });
    }
    if (!attachFile(db, noteId, bytes, headerText(req.headers["x-file-name"]), headerText(req.headers["x-file-type"]))) return reply.code(404).send(notFound);
    return reply.code(201).send({ ok: true, data: { note: getNote(db, noteId) } });
  });

  app.post("/api/notes/:id/links", async (req, reply) => {
    const noteId = parseId((req.params as Record<string, string>).id);
    const parsed = AddNoteLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "http 또는 https 주소를 넣으세요" } });
    if (!noteId || !attachLink(db, noteId, parsed.data.url, parsed.data.name)) return reply.code(404).send(notFound);
    return reply.code(201).send({ ok: true, data: { note: getNote(db, noteId) } });
  });

  app.delete("/api/notes/:id/attachments/:attachmentId", async (req, reply) => {
    const params = req.params as Record<string, string>;
    const noteId = parseId(params.id);
    const attachmentId = parseId(params.attachmentId);
    if (!noteId || !attachmentId || !detachAttachment(db, noteId, attachmentId)) return reply.code(404).send(notFound);
    return reply.send({ ok: true, data: { note: getNote(db, noteId) } });
  });

  app.get("/api/files/:id", async (req, reply) => {
    const id = parseId((req.params as Record<string, string>).id);
    const file = id ? findFile(db, id, { sharedOnly: isRemoteAudience(req) }) : null;
    if (!file) return reply.code(404).send({ ok: false, error: { code: "NOT_FOUND", message: "파일을 찾을 수 없습니다" } });
    const inline = isInlineType(file.mime) && (req.query as Record<string, string>).download === undefined;
    return reply
      .header("content-type", inline ? file.mime : "application/octet-stream")
      .header("content-length", file.size)
      .header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "private, max-age=3600")
      .send(createReadStream(file.fullPath));
  });
}
