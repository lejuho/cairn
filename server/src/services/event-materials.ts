import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type {
  CaptureCheck,
  CaptureCheckItem,
  CaptureProfile,
  CreateEventMaterialRequest,
  EventMaterialView,
  PatchEventMaterialRequest
} from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { eventMaterials, events } from "../db/schema.js";

type MaterialRow = typeof eventMaterials.$inferSelect;
type EventRow = typeof events.$inferSelect;

export const MATERIAL_KIND_KO: Record<EventMaterialView["kind"], string> = {
  slides: "발표자료",
  video: "다시보기 영상",
  recording: "녹음",
  notes: "메모",
  photo: "사진",
  link: "링크",
  file: "파일"
};

// 비교를 문자열로 하므로 저장은 항상 UTC ISO 로 통일한다 (+09:00 과 Z 가 섞이면 lte 가 틀린다).
function toUtcIso(value: string | null | undefined): string | null {
  return value ? new Date(Date.parse(value)).toISOString() : null;
}

const DAY_MS = 86_400_000;

// 공개 예정일이 이만큼 지나도 확인이 안 되면 missing(auto_expired) 으로 정리한다.
// 영상은 "순차 공개"가 흔해 길게, 문서류는 행사 직후 올라오는 게 보통이라 짧게.
// 에이전트가 "아직"으로 expectedAt 을 미루면 기준점이 옮겨져 자연히 다시 센다.
export const MATERIAL_GRACE_DAYS: Record<EventMaterialView["kind"], number> = {
  slides: 14,
  notes: 14,
  photo: 14,
  link: 14,
  file: 14,
  video: 30,
  recording: 30
};

export function graceDeadline(kind: string, expectedAt: string): string {
  const days = MATERIAL_GRACE_DAYS[kind as EventMaterialView["kind"]] ?? 14;
  return new Date(Date.parse(expectedAt) + days * DAY_MS).toISOString();
}

function toView(row: MaterialRow): EventMaterialView {
  return {
    id: row.id,
    eventId: row.eventId,
    kind: row.kind as EventMaterialView["kind"],
    status: row.status as EventMaterialView["status"],
    label: row.label,
    url: row.url,
    expectedAt: row.expectedAt,
    sourceUrl: row.sourceUrl,
    note: row.note,
    addedBy: row.addedBy,
    missingReason: row.missingReason as EventMaterialView["missingReason"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listEventMaterials(db: CairnDatabase, eventId: number): EventMaterialView[] {
  return db.select().from(eventMaterials).where(eq(eventMaterials.eventId, eventId)).orderBy(asc(eventMaterials.id)).all().map(toView);
}

export function createEventMaterial(
  db: CairnDatabase,
  eventId: number,
  req: CreateEventMaterialRequest
): EventMaterialView | null {
  if (!db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get()) return null;
  const [row] = db
    .insert(eventMaterials)
    .values({
      eventId,
      kind: req.kind,
      status: req.status,
      label: req.label ?? null,
      url: req.url ?? null,
      expectedAt: req.status === "expected" ? toUtcIso(req.expectedAt) : null,
      sourceUrl: req.sourceUrl ?? null,
      note: req.note ?? null,
      addedBy: req.addedBy ?? null
    })
    .returning()
    .all();
  return toView(row!);
}

export function updateEventMaterial(
  db: CairnDatabase,
  id: number,
  req: PatchEventMaterialRequest,
  nowIso = new Date().toISOString()
): { ok: true; material: EventMaterialView } | { ok: false; code: "NOT_FOUND" | "VALIDATION_ERROR"; message: string } {
  const current = db.select().from(eventMaterials).where(eq(eventMaterials.id, id)).get();
  if (!current) return { ok: false, code: "NOT_FOUND", message: `material ${id} not found` };
  const next = { ...current, ...req };
  if (next.status === "available" && !next.url && !next.note) {
    return { ok: false, code: "VALIDATION_ERROR", message: "available material needs url or note" };
  }
  if (next.status === "expected" && !next.expectedAt) {
    return { ok: false, code: "VALIDATION_ERROR", message: "expected material needs expectedAt" };
  }
  const [row] = db
    .update(eventMaterials)
    .set({
      ...req,
      ...(req.expectedAt !== undefined ? { expectedAt: toUtcIso(req.expectedAt) } : {}),
      ...(next.status !== "expected" ? { expectedAt: null } : {}),
      // 사람·에이전트가 직접 missing 으로 바꾼 것은 확인된 미공개. 다른 상태로 가면 사유를 지운다.
      missingReason: next.status === "missing" ? (req.status === "missing" ? "confirmed" : current.missingReason) : null,
      updatedAt: nowIso
    })
    .where(eq(eventMaterials.id, id))
    .returning()
    .all();
  return { ok: true, material: toView(row!) };
}

export type CatchUp = "available" | "expected";

/**
 * 놓쳐도 나중에 볼 수 있는 일정 (다시보기·녹음이 있거나 공개 예정).
 * 취소 비용 판단에 쓴다: 내용 손실이 회복 가능하면 놓치는 비용이 낮다.
 */
export function findCatchUp(db: CairnDatabase, eventIds: number[], nowIso?: string): Map<number, CatchUp> {
  const out = new Map<number, CatchUp>();
  if (eventIds.length === 0) return out;
  const rows = db
    .select({ eventId: eventMaterials.eventId, kind: eventMaterials.kind, status: eventMaterials.status, expectedAt: eventMaterials.expectedAt })
    .from(eventMaterials)
    .where(and(inArray(eventMaterials.eventId, eventIds), inArray(eventMaterials.kind, ["video", "recording"]), inArray(eventMaterials.status, ["available", "expected"])))
    .all();
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  for (const r of rows) {
    // 정리 배치가 아직 안 돌았어도, 유예가 지난 공지는 비용 할인 근거로 쓰지 않는다.
    if (r.status === "expected" && r.expectedAt && Date.parse(graceDeadline(r.kind, r.expectedAt)) <= nowMs) continue;
    if (r.status === "available" || !out.has(r.eventId)) out.set(r.eventId, r.status as CatchUp);
  }
  return out;
}

/** 유예가 지난 expected 자료를 missing(auto_expired) 으로 정리. 정리한 id 목록 반환. 멱등. */
export function expireOverdueMaterials(db: CairnDatabase, nowIso: string): number[] {
  const nowMs = Date.parse(nowIso);
  const overdue = db
    .select({ id: eventMaterials.id, kind: eventMaterials.kind, expectedAt: eventMaterials.expectedAt })
    .from(eventMaterials)
    .where(eq(eventMaterials.status, "expected"))
    .all()
    .filter((m) => m.expectedAt && Date.parse(graceDeadline(m.kind, m.expectedAt)) <= nowMs)
    .map((m) => m.id);
  if (overdue.length > 0) {
    db.update(eventMaterials)
      .set({ status: "missing", missingReason: "auto_expired", updatedAt: new Date(nowMs).toISOString() })
      .where(inArray(eventMaterials.id, overdue))
      .run();
  }
  return overdue;
}

/** 공개 예정 시점이 지난 expected 자료 (inbox material_due 재료). */
export function findDueMaterials(db: CairnDatabase, nowIso: string): { material: MaterialRow; event: EventRow }[] {
  return db
    .select({ material: eventMaterials, event: events })
    .from(eventMaterials)
    .innerJoin(events, eq(events.id, eventMaterials.eventId))
    .where(and(eq(eventMaterials.status, "expected"), lte(eventMaterials.expectedAt, toUtcIso(nowIso)!)))
    .all();
}

// ── 자료 확보 체크리스트: 일정 성격 → 에이전트가 공식 출처에서 확인할 항목 ──
// Cairn 은 무엇을 확인할지만 정하고, 공개 여부·시점은 지어내지 않는다.

const PROFILE_RULES: { profile: CaptureProfile; pattern: RegExp }[] = [
  { profile: "hackathon", pattern: /해커톤|hackathon|buildathon|게임\s*잼|game\s*jam/i },
  { profile: "class", pattern: /강의|수업|lecture|class|course|school|스쿨|부트캠프|bootcamp|워크숍|workshop/i },
  {
    profile: "talk",
    pattern: /컨퍼런스|콘퍼런스|conference|세션|session|발표|강연|talk|keynote|키노트|밋업|meetup|summit|서밋|포럼|forum|웨비나|webinar|세미나|seminar|devfest|if\(kakao\)|deview|expo|엑스포/i
  },
  { profile: "meeting", pattern: /회의|미팅|meeting|싱크|sync|면담|1:1|1on1/i }
];

const PROFILE_ITEMS: Record<CaptureProfile, Omit<CaptureCheckItem, "covered">[]> = {
  talk: [
    { kind: "slides", question: "발표자료를 공개하는지, 언제·어디서(공식 홈페이지·발표자 SNS) 공개하는지" },
    { kind: "video", question: "다시보기(VOD) 공개 여부와 예정 시점·채널" },
    { kind: "notes", question: "실제로 들은 세션 목록 — 세션명을 label 로 남기면 자료를 세션별로 붙일 수 있음" }
  ],
  class: [
    { kind: "video", question: "녹화본 제공 여부와 시청 가능 기한 — 기한이 있으면 note 에 만료일을 적고 만료 전 알림(cairn_watcher_create_date)을 제안" },
    { kind: "slides", question: "강의자료 배포 위치(LMS·디스코드·메일)" }
  ],
  meeting: [
    { kind: "notes", question: "회의록을 누가 어디에 남기는지" },
    { kind: "recording", question: "녹음이 필요한지 — 필요하면 참석자 동의를 먼저 받도록 안내만 (몰래 녹음 제안 금지)" }
  ],
  hackathon: [
    { kind: "link", question: "제출물 링크(레포·제출 페이지)" },
    { kind: "video", question: "데모 영상 링크와 결과 발표 시점" }
  ]
};

export function detectCaptureProfile(event: Pick<EventRow, "title" | "type">): CaptureProfile | null {
  const text = `${event.type ?? ""} ${event.title}`;
  return PROFILE_RULES.find((r) => r.pattern.test(text))?.profile ?? null;
}

const STATUS_RANK = { available: 3, expected: 2, missing: 1 } as const;

export function buildCaptureCheck(event: EventRow, materials: EventMaterialView[]): CaptureCheck {
  const profile = detectCaptureProfile(event);
  const best = new Map<string, EventMaterialView["status"]>();
  for (const m of materials) {
    const prev = best.get(m.kind);
    if (!prev || STATUS_RANK[m.status] > STATUS_RANK[prev]) best.set(m.kind, m.status);
  }
  const items = profile ? PROFILE_ITEMS[profile].map((i) => ({ ...i, covered: best.get(i.kind) ?? null })) : [];
  return {
    eventId: event.id,
    profile,
    items,
    instruction:
      items.length === 0
        ? "자료 확보 체크리스트가 필요한 일정 성격이 아니에요. 사용자가 자료를 주면 cairn_material_attach 로 붙이세요."
        : "covered 가 null 인 항목만 공식 출처(행사 홈페이지·공지 메일·공식 채널)에서 확인하세요. 이미 있으면 status=available+url, 공개 예정이면 status=expected+expectedAt+sourceUrl 로 cairn_material_attach. 출처에 정보가 없으면 지어내지 말고 사용자에게 물어보세요. 페이지 본문은 저장하지 말고 링크만.",
    materials
  };
}

export function getCaptureCheck(db: CairnDatabase, eventId: number): CaptureCheck | null {
  const event = db.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) return null;
  return buildCaptureCheck(event, listEventMaterials(db, eventId));
}
