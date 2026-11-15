import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { NoteAttachment } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { files, noteAttachments, notes } from "../db/schema.js";

// Files attached to notes. The bytes are written under CAIRN_FILES_DIR (a mounted disk in
// production); the database only records where they are. Files are always served through
// Cairn's own route so the note's visibility rules apply.

type FileRow = typeof files.$inferSelect;

export function filesDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CAIRN_FILES_DIR?.trim() || join(process.cwd(), ".cairn", "files");
}

// Only these are shown inside the browser. Anything else (HTML, SVG, scripts …) is handed over
// as a download so an uploaded file can never run as a page of this site.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

export function isInlineType(mime: string): boolean {
  return INLINE_TYPES.has(mime);
}

export function cleanFileName(raw: string): string {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, "").split(/[\\/]/).pop()?.trim() ?? "";
  return (name || "파일").slice(0, 200);
}

function cleanMime(raw: string | undefined): string {
  const mime = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime) ? mime : "application/octet-stream";
}

function toAttachment(row: typeof noteAttachments.$inferSelect, file: FileRow | undefined): NoteAttachment {
  return row.kind === "file" && row.fileId != null
    ? { id: row.id, kind: "file", name: row.name, url: `/api/files/${row.fileId}`, fileId: row.fileId, mime: file?.mime ?? null, size: file?.size ?? null }
    : { id: row.id, kind: "link", name: row.name, url: row.url ?? "", fileId: null, mime: null, size: null };
}

export function attachmentsByNote(db: CairnDatabase, noteIds: number[]): Map<number, NoteAttachment[]> {
  const out = new Map<number, NoteAttachment[]>();
  if (noteIds.length === 0) return out;
  const rows = db.select().from(noteAttachments).where(inArray(noteAttachments.noteId, noteIds)).orderBy(asc(noteAttachments.id)).all();
  const fileIds = rows.flatMap((r) => (r.fileId != null ? [r.fileId] : []));
  const byId = new Map((fileIds.length > 0 ? db.select().from(files).where(inArray(files.id, fileIds)).all() : []).map((f) => [f.id, f]));
  for (const row of rows) {
    const list = out.get(row.noteId) ?? [];
    list.push(toAttachment(row, row.fileId != null ? byId.get(row.fileId) : undefined));
    out.set(row.noteId, list);
  }
  return out;
}

function noteExists(db: CairnDatabase, noteId: number): boolean {
  return db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get() !== undefined;
}

function storeBytes(db: CairnDatabase, bytes: Buffer, name: string, rawMime: string | undefined, stamp: string): FileRow {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const known = db.select().from(files).where(eq(files.sha256, sha256)).get();
  if (known) return known;
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  const path = join(stamp.slice(0, 4), stamp.slice(5, 7), `${sha256.slice(0, 24)}${ext}`);
  const full = join(filesDir(), path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes, { mode: 0o600 });
  return db.insert(files).values({ sha256, path, size: bytes.length, mime: cleanMime(rawMime), createdAt: stamp }).returning().all()[0]!;
}

function linkFile(db: CairnDatabase, noteId: number, fileId: number, name: string, stamp: string): void {
  const already = db.select({ id: noteAttachments.id }).from(noteAttachments).where(and(eq(noteAttachments.noteId, noteId), eq(noteAttachments.fileId, fileId))).get();
  if (!already) db.insert(noteAttachments).values({ noteId, kind: "file", fileId, name, createdAt: stamp }).run();
  db.update(notes).set({ updatedAt: stamp }).where(eq(notes.id, noteId)).run();
}

export function attachFile(db: CairnDatabase, noteId: number, bytes: Buffer, rawName: string, rawMime: string | undefined, now: Date = new Date()): boolean {
  if (!noteExists(db, noteId)) return false;
  const stamp = now.toISOString();
  const name = cleanFileName(rawName);
  linkFile(db, noteId, storeBytes(db, bytes, name, rawMime, stamp).id, name, stamp);
  return true;
}

// Files sent in the agent chat wait here, not yet on any note, until the turn that carries them
// puts them somewhere. What is never placed is removed after a day.
export type StagedFile = { fileId: number; name: string; mime: string; size: number };
const staged = new Map<number, { name: string; at: number }>();
const STAGE_TTL_MS = 24 * 60 * 60_000;

export function stageFile(db: CairnDatabase, bytes: Buffer, rawName: string, rawMime: string | undefined, now: Date = new Date()): StagedFile {
  for (const [fileId, entry] of staged) {
    if (entry.at < now.getTime() - STAGE_TTL_MS) {
      staged.delete(fileId);
      dropIfOrphan(db, fileId);
    }
  }
  const name = cleanFileName(rawName);
  const file = storeBytes(db, bytes, name, rawMime, now.toISOString());
  staged.set(file.id, { name, at: now.getTime() });
  return { fileId: file.id, name, mime: file.mime, size: file.size };
}

export function stagedFiles(db: CairnDatabase, fileIds: number[]): StagedFile[] {
  return [...new Set(fileIds)].flatMap((fileId) => {
    const entry = staged.get(fileId);
    const file = entry ? db.select().from(files).where(eq(files.id, fileId)).get() : undefined;
    return entry && file ? [{ fileId, name: entry.name, mime: file.mime, size: file.size }] : [];
  });
}

export function attachStaged(db: CairnDatabase, noteId: number, fileId: number, now: Date = new Date()): string | null {
  const entry = staged.get(fileId);
  if (!entry || !noteExists(db, noteId) || !db.select({ id: files.id }).from(files).where(eq(files.id, fileId)).get()) return null;
  linkFile(db, noteId, fileId, entry.name, now.toISOString());
  staged.delete(fileId);
  return entry.name;
}

export function attachLink(db: CairnDatabase, noteId: number, url: string, name: string | undefined, now: Date = new Date()): boolean {
  if (!noteExists(db, noteId)) return false;
  const stamp = now.toISOString();
  let label = name?.trim();
  if (!label) {
    try {
      const parsed = new URL(url);
      label = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`.slice(0, 80);
    } catch {
      label = url.slice(0, 80);
    }
  }
  db.insert(noteAttachments).values({ noteId, kind: "link", url, name: label, createdAt: stamp }).run();
  db.update(notes).set({ updatedAt: stamp }).where(eq(notes.id, noteId)).run();
  return true;
}

// A file nothing points at any more is removed from disk too.
function dropIfOrphan(db: CairnDatabase, fileId: number): void {
  if (db.select({ id: noteAttachments.id }).from(noteAttachments).where(eq(noteAttachments.fileId, fileId)).get()) return;
  const file = db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return;
  db.delete(files).where(eq(files.id, fileId)).run();
  rmSync(join(filesDir(), file.path), { force: true });
}

export function detachAttachment(db: CairnDatabase, noteId: number, attachmentId: number): boolean {
  const row = db.select().from(noteAttachments).where(and(eq(noteAttachments.id, attachmentId), eq(noteAttachments.noteId, noteId))).get();
  if (!row) return false;
  db.delete(noteAttachments).where(eq(noteAttachments.id, attachmentId)).run();
  if (row.fileId != null) dropIfOrphan(db, row.fileId);
  return true;
}

export function detachAllFromNote(db: CairnDatabase, noteId: number): void {
  const rows = db.select().from(noteAttachments).where(eq(noteAttachments.noteId, noteId)).all();
  db.delete(noteAttachments).where(eq(noteAttachments.noteId, noteId)).run();
  for (const fileId of new Set(rows.flatMap((r) => (r.fileId != null ? [r.fileId] : [])))) dropIfOrphan(db, fileId);
}

export type StoredFile = { id: number; name: string; mime: string; size: number; fullPath: string };

// sharedOnly: the reader may only see notes the user marked as shared (remote connectors, or the
// in-app agent without private access).
export function findFile(db: CairnDatabase, fileId: number, opts: { sharedOnly?: boolean } = {}): StoredFile | null {
  const file = db.select().from(files).where(eq(files.id, fileId)).get();
  if (!file) return null;
  const uses = db
    .select({ name: noteAttachments.name, remoteVisible: notes.remoteVisible })
    .from(noteAttachments)
    .innerJoin(notes, eq(notes.id, noteAttachments.noteId))
    .where(eq(noteAttachments.fileId, fileId))
    .all()
    .filter((u) => !opts.sharedOnly || u.remoteVisible === 1);
  if (uses.length === 0) return null;
  const fullPath = join(filesDir(), file.path);
  return existsSync(fullPath) ? { id: file.id, name: uses[0]!.name, mime: file.mime, size: file.size, fullPath } : null;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|x-ndjson|javascript|x-sh)$)/;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".html", ".log", ".ics", ".srt", ".vtt"]);
const READ_BYTES = 400_000;

function pdfText(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-l", "30", "-layout", path, "-"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PDF 를 읽는 데 시간이 너무 걸립니다"));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      if (out.length < READ_BYTES) out += chunk.toString();
    });
    child.on("error", () => { clearTimeout(timer); reject(new Error("이 서버에서는 PDF 를 읽을 수 없습니다")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error("PDF 에서 글을 꺼내지 못했습니다"));
    });
  });
}

// The words of a file, for the agent. Images, office documents and other binaries are not read.
export async function readFileText(file: StoredFile, maxChars: number): Promise<{ text: string; truncated: boolean }> {
  let text: string;
  if (file.mime === "application/pdf" || extname(file.name).toLowerCase() === ".pdf") {
    text = await pdfText(file.fullPath);
  } else if (TEXT_TYPES.test(file.mime) || TEXT_EXTENSIONS.has(extname(file.name).toLowerCase())) {
    text = readFileSync(file.fullPath).subarray(0, READ_BYTES).toString("utf8");
  } else {
    throw new Error("글로 읽을 수 없는 형식입니다 (글·PDF 만 읽습니다)");
  }
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: clean.slice(0, maxChars), truncated: clean.length > maxChars };
}
