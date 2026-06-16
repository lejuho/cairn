import { eq } from "drizzle-orm";
import type { CairnDatabase, SqliteConnection } from "../db/index.js";
import { params } from "../db/schema.js";
import type { GcalClient } from "./client.js";
import { mapGcalEvent } from "./mapping.js";

const SYNC_TOKEN_KEY = "gcal.primary.syncToken";
const LAST_SYNC_AT_KEY = "gcal.primary.lastSyncAt";
const CALENDAR_ID = "primary";

export type SyncOptions = {
  connection: SqliteConnection;
  client: GcalClient;
  timeZone?: string;
};

export type SyncResult = {
  upserted: number;
  cancelled: number;
  skipped: number;
};

export async function syncGcalPrimary(opts: SyncOptions): Promise<SyncResult> {
  const { connection, client, timeZone = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul" } = opts;

  const existingToken = readParam(connection, SYNC_TOKEN_KEY);

  try {
    return await runSync(connection, client, timeZone, existingToken ?? undefined);
  } catch (err: unknown) {
    if (isGone(err)) {
      clearParam(connection, SYNC_TOKEN_KEY);
      return await runSync(connection, client, timeZone, undefined);
    }
    throw err;
  }
}

async function runSync(
  connection: SqliteConnection,
  client: GcalClient,
  timeZone: string,
  syncToken: string | undefined
): Promise<SyncResult> {
  const { db, sqlite } = connection;
  let upserted = 0;
  let cancelled = 0;
  let skipped = 0;
  let pageToken: string | undefined;

  const isFullSync = !syncToken;
  const now = new Date();
  const timeMin = isFullSync
    ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    : undefined;
  const timeMax = isFullSync
    ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  let lastSyncToken: string | null | undefined;

  const upsertStmt = sqlite.prepare(`
    INSERT INTO events (
      title, start, end, type, source, self_imposed, status,
      external_calendar_id, external_event_id,
      external_ical_uid, external_etag, external_updated,
      updated_at
    ) VALUES (
      ?, ?, ?, ?, 'gcal', 0, ?,
      ?, ?,
      ?, ?, ?,
      ?
    )
    ON CONFLICT (external_calendar_id, external_event_id) DO UPDATE SET
      title = excluded.title,
      start = excluded.start,
      end = excluded.end,
      type = excluded.type,
      status = excluded.status,
      external_ical_uid = excluded.external_ical_uid,
      external_etag = excluded.external_etag,
      external_updated = excluded.external_updated,
      updated_at = excluded.updated_at
  `);

  const cancelStmt = sqlite.prepare(`
    UPDATE events
    SET status = 'cancelled', updated_at = ?
    WHERE external_calendar_id = ?
      AND external_event_id = ?
      AND external_event_id IS NOT NULL
  `);

  do {
    const result = await client.list({
      calendarId: CALENDAR_ID,
      ...(syncToken !== undefined ? { syncToken } : {}),
      ...(pageToken !== undefined ? { pageToken } : {}),
      ...(timeMin !== undefined ? { timeMin } : {}),
      ...(timeMax !== undefined ? { timeMax } : {}),
      singleEvents: true
    });

    for (const item of result.items) {
      const mapped = mapGcalEvent(CALENDAR_ID, item, timeZone);
      if (!mapped) {
        skipped++;
        continue;
      }

      if (mapped.status === "cancelled") {
        const info = cancelStmt.run(
          now.toISOString(),
          mapped.externalCalendarId,
          mapped.externalEventId
        );
        if (info.changes > 0) {
          cancelled++;
        } else {
          skipped++;
        }
        continue;
      }

      upsertStmt.run(
        mapped.title,
        mapped.start,
        mapped.end,
        mapped.type,
        mapped.status,
        mapped.externalCalendarId,
        mapped.externalEventId,
        mapped.externalIcalUid,
        mapped.externalEtag,
        mapped.externalUpdated,
        now.toISOString()
      );
      upserted++;
    }

    pageToken = result.nextPageToken ?? undefined;
    if (result.nextSyncToken) {
      lastSyncToken = result.nextSyncToken;
    }
  } while (pageToken);

  // Persist syncToken only after all pages succeed.
  if (lastSyncToken) {
    upsertParam(db, SYNC_TOKEN_KEY, lastSyncToken);
  }
  upsertParam(db, LAST_SYNC_AT_KEY, now.toISOString());

  return { upserted, cancelled, skipped };
}

function isGone(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    return e["code"] === 410 || e["status"] === 410;
  }
  return false;
}

function readParam(connection: SqliteConnection, key: string): string | null {
  const row = connection.db.select().from(params).where(eq(params.key, key)).get();
  return row?.value ?? null;
}

function upsertParam(db: CairnDatabase, key: string, value: string): void {
  db
    .insert(params)
    .values({ key, value })
    .onConflictDoUpdate({ target: params.key, set: { value } })
    .run();
}

function clearParam(connection: SqliteConnection, key: string): void {
  connection.db.delete(params).where(eq(params.key, key)).run();
}
