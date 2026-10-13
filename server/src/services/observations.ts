import { and, desc, eq, isNull, lte } from "drizzle-orm";
import type { CreateObservationRequest } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import { observations } from "../db/schema.js";

type ObservationRow = typeof observations.$inferSelect;

// 인증번호·OTP 류는 저장 자체를 하지 않는다 (폰 쪽 필터가 놓친 경우의 2차 방어).
const SENSITIVE_PATTERNS = [
  /인증\s*번호/,
  /인증\s*코드/,
  /verification\s*code/i,
  /\bOTP\b/i,
  /보안\s*코드/,
  /\b\d{6}\b.*(인증|코드|code)/i,
  /승인\s*번호/
];

const PHONE_BODY_RETENTION_DAYS = 14;

export type InsertObservationResult =
  | { stored: true; id: number }
  | { stored: false; reason: "duplicate" | "filtered" };

export function isSensitiveNotification(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

export function insertObservation(db: CairnDatabase, input: CreateObservationRequest): InsertObservationResult {
  const text = `${input.title ?? ""}\n${input.body ?? ""}`;
  if (input.source === "phone_notification" && (isSensitiveNotification(text) || !text.trim())) {
    return { stored: false, reason: "filtered" };
  }
  const [row] = db
    .insert(observations)
    .values({
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      app: input.app ?? null,
      title: input.title ?? null,
      body: input.body ?? null,
      cwd: input.cwd ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      meta: input.meta ? JSON.stringify(input.meta) : null
    })
    .onConflictDoNothing()
    .returning({ id: observations.id })
    .all();
  return row ? { stored: true, id: row.id } : { stored: false, reason: "duplicate" };
}

export function listRecentObservations(db: CairnDatabase, source: string | undefined, limit: number): ObservationRow[] {
  const q = db.select().from(observations);
  return (source ? q.where(eq(observations.source, source)) : q).orderBy(desc(observations.id)).limit(limit).all();
}

export function findUnprocessedObservations(db: CairnDatabase, source: string, limit: number): ObservationRow[] {
  return db
    .select()
    .from(observations)
    .where(and(eq(observations.source, source), isNull(observations.processedAt)))
    .orderBy(observations.id)
    .limit(limit)
    .all();
}

export function markObservationsProcessed(db: CairnDatabase, ids: number[], nowIso: string): void {
  for (const id of ids) {
    db.update(observations).set({ processedAt: nowIso }).where(eq(observations.id, id)).run();
  }
}

/** 처리 끝난 폰 알림 원문은 보존 기한이 지나면 본문을 지운다 (추출 결과는 inbox 에 남음). */
export function purgeOldPhoneBodies(db: CairnDatabase, nowIso: string): void {
  // received_at 은 SQLite datetime('now') 형식(YYYY-MM-DD HH:MM:SS)이라 같은 형식으로 비교.
  const cutoff = new Date(Date.parse(nowIso) - PHONE_BODY_RETENTION_DAYS * 86_400_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  db.update(observations)
    .set({ body: null, title: null })
    .where(and(eq(observations.source, "phone_notification"), lte(observations.receivedAt, cutoff)))
    .run();
}
