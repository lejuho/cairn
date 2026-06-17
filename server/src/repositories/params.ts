import { eq } from "drizzle-orm";
import type { CairnDatabase } from "../db/index.js";
import { params } from "../db/schema.js";

export function readParam(db: CairnDatabase, key: string): string | null {
  const row = db.select().from(params).where(eq(params.key, key)).get();
  return row?.value ?? null;
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
