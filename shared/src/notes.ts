import { z } from "zod";

// 빠른 메모·체크리스트. 날짜(noteDate)와 일정/할 일/스레드(links)에 붙여 두고,
// 나중에 날짜·대상·검색어로 다시 찾는다. 사용자가 직접 쓴 글이라 본문을 그대로 저장한다.

export const NOTE_KINDS = ["note", "checklist"] as const;
export const NoteKindSchema = z.enum(NOTE_KINDS);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const NOTE_TARGET_TYPES = ["event", "task", "thread"] as const;
export const NoteTargetTypeSchema = z.enum(NOTE_TARGET_TYPES);
export type NoteTargetType = z.infer<typeof NoteTargetTypeSchema>;

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const positiveId = z.number().int().positive();

export const NoteLinkInputSchema = z.object({ targetType: NoteTargetTypeSchema, targetId: positiveId }).strict();
export type NoteLinkInput = z.infer<typeof NoteLinkInputSchema>;

// id 가 있으면 기존 항목을 고치고(완료 시각 보존), 없으면 새 항목으로 만든다.
export const NoteItemInputSchema = z
  .object({
    id: positiveId.optional(),
    text: z.string().trim().min(1).max(300),
    done: z.boolean().optional()
  })
  .strict();
export type NoteItemInput = z.infer<typeof NoteItemInputSchema>;

const title = z.string().trim().max(200);
const body = z.string().max(10_000);
const items = z.array(NoteItemInputSchema).max(100);
const links = z.array(NoteLinkInputSchema).max(20);

export const CreateNoteRequestSchema = z
  .object({
    kind: NoteKindSchema.default("note"),
    title: title.optional(),
    body: body.optional(),
    // 이 메모가 속한 날 (로컬 날짜). 없으면 날짜에 붙지 않은 메모.
    noteDate: localDate.optional(),
    items: items.optional(),
    links: links.optional(),
    pinned: z.boolean().optional(),
    // 원격 MCP 커넥터(ChatGPT 등)에 보여도 되는가. 기본은 비공개.
    remoteVisible: z.boolean().optional(),
    addedBy: z.string().max(100).optional()
  })
  .strict()
  .refine((v) => Boolean(v.title?.trim()) || Boolean(v.body?.trim()) || (v.items?.length ?? 0) > 0, {
    message: "note needs title, body or items"
  });
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;

export const PatchNoteRequestSchema = z
  .object({
    kind: NoteKindSchema.optional(),
    title: title.nullable().optional(),
    body: body.nullable().optional(),
    noteDate: localDate.nullable().optional(),
    // 주면 전체 교체. 빠진 항목은 지워진다.
    items: items.optional(),
    links: links.optional(),
    pinned: z.boolean().optional(),
    remoteVisible: z.boolean().optional(),
    archived: z.boolean().optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type PatchNoteRequest = z.infer<typeof PatchNoteRequestSchema>;

export const AddNoteItemRequestSchema = z.object({ text: z.string().trim().min(1).max(300) }).strict();
export type AddNoteItemRequest = z.infer<typeof AddNoteItemRequestSchema>;

export const PatchNoteItemRequestSchema = z
  .object({ text: z.string().trim().min(1).max(300).optional(), done: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type PatchNoteItemRequest = z.infer<typeof PatchNoteItemRequestSchema>;

const queryBool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export const NoteListQuerySchema = z
  .object({
    // 공백으로 나눈 모든 단어가 제목·본문·체크 항목·붙은 대상 이름 어딘가에 있어야 한다.
    q: z.string().trim().max(200).optional(),
    // date 는 하루, from/to 는 범위(양끝 포함). 메모 날짜뿐 아니라 붙은 일정·할 일의 날짜도 본다.
    date: localDate.optional(),
    from: localDate.optional(),
    to: localDate.optional(),
    targetType: NoteTargetTypeSchema.optional(),
    targetId: z.coerce.number().int().positive().optional(),
    kind: NoteKindSchema.optional(),
    // 끝나지 않은 항목이 남은 체크리스트만.
    open: queryBool.optional(),
    includeArchived: queryBool.optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100)
  })
  .strict()
  .refine((v) => (v.targetType === undefined) === (v.targetId === undefined), {
    message: "targetType and targetId go together"
  });
export type NoteListQuery = z.infer<typeof NoteListQuerySchema>;

export const NoteTargetQuerySchema = z
  .object({ q: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(8) })
  .strict();

export type NoteItemView = {
  id: number;
  text: string;
  done: boolean;
  doneAt: string | null;
  position: number;
  // 이 항목에서 만든 할 일의 id. 없으면 null.
  taskId: number | null;
};

// 메모가 붙은 대상의 현재 모습. 대상이 지워졌으면 exists=false 로 남는다.
export type NoteTargetView = {
  targetType: NoteTargetType;
  targetId: number;
  label: string;
  // event: start, task: due, thread: deadline. 없으면 null.
  when: string | null;
  status: string | null;
  exists: boolean;
};

// 메모에 붙인 것 하나. 파일이면 url 은 Cairn 이 내주는 주소(/api/files/:id), 링크면 바깥 주소다.
export type NoteAttachment = {
  id: number;
  kind: "file" | "link";
  name: string;
  url: string;
  fileId: number | null;
  mime: string | null;
  size: number | null;
};

// 올릴 수 있는 파일 하나의 최대 크기. 이보다 크면 링크(구글 드라이브 등)로 붙인다.
export const NOTE_FILE_MAX_BYTES = 50 * 1024 * 1024;

export const AddNoteLinkRequestSchema = z
  .object({ url: z.string().trim().url().max(2000).regex(/^https?:\/\//i, "http(s) 주소만"), name: z.string().trim().max(200).optional() })
  .strict();

export type NoteView = {
  id: number;
  kind: NoteKind;
  title: string | null;
  body: string | null;
  noteDate: string | null;
  pinned: boolean;
  // 원격 MCP 커넥터에 공개된 메모인가. false 면 원격 요청에는 존재 자체가 드러나지 않는다.
  remoteVisible: boolean;
  items: NoteItemView[];
  links: NoteTargetView[];
  // 붙인 파일과 링크. 서버는 항상 채워 보낸다.
  attachments?: NoteAttachment[];
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

// 검색어에 이름이 걸린 일정·할 일·스레드. 메모가 없어도 과거 일정 자체를 찾을 수 있게 한다.
export type NoteRelatedTarget = NoteTargetView & { noteCount: number; location: string | null };

export type NoteListData = {
  notes: NoteView[];
  total: number;
  related: NoteRelatedTarget[];
};

export type NoteTargetListData = { targets: NoteTargetView[] };

// 메모 → 일정. AI 가 메모 글에서 제목·시작 시각을 읽어 초안을 주고, 사용자가 확인·수정한 값으로 만든다.
// parseStatus=unparsed 는 AI 를 못 썼거나 날짜를 못 읽은 경우 — 그래도 제목은 채워서 돌려준다.
export type NoteEventDraftData = {
  title: string;
  start: string | null;
  end: string | null;
  parseStatus: "parsed" | "unparsed";
  llmError?: string;
};

export const CreateEventFromNoteRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true })
  })
  .strict()
  .refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: "end must be after start" });
export type CreateEventFromNoteRequest = z.infer<typeof CreateEventFromNoteRequestSchema>;

// 아직 저장하지 않은 글에서 일정 초안을 읽는다 (빠른 기록 2단계에서 "일정"을 골랐을 때).
export const EventDraftFromTextRequestSchema = z.object({ text: z.string().trim().min(1).max(2000) }).strict();

// 체크 항목을 할 일로 만들 때 함께 줄 수 있는 값.
export const CreateTaskFromNoteItemRequestSchema = z
  .object({ estMinutes: z.number().int().positive().max(1440).optional() })
  .strict();
