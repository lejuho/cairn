import { eq } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { params } from "../db/schema.js";

export function readParam(db: CairnDatabase, key: string): string | null {
  const row = db.select().from(params).where(eq(params.key, key)).get();
  return row?.value ?? null;
}

export function readNumericParam(db: CairnDatabase, key: string, defaultValue: number): number {
  const row = db.select().from(params).where(eq(params.key, key)).get();
  if (!row || row.value == null || row.value.trim() === "") return defaultValue;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export function upsertParam(db: CairnDatabase, key: string, value: string): void {
  db
    .insert(params)
    .values({ key, value })
    .onConflictDoUpdate({ target: params.key, set: { value } })
    .run();
}

export function clearParam(db: CairnDatabase, key: string): void {
  db.delete(params).where(eq(params.key, key)).run();
}
