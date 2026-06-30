import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { GcalSyncStatusData, GcalSyncResult } from "@cairn/shared";
import { params } from "../db/schema.js";
import type { SqliteConnection } from "../db/index.js";
import { createGcalClient, type GcalClient } from "../gcal/client.js";
import { loadTokens, type OAuthCredentials, type TokenStore } from "../gcal/auth.js";
import { GCAL_LAST_SYNC_AT_KEY, GCAL_SYNC_TOKEN_KEY, syncGcalPrimary } from "../gcal/sync.js";

export type GcalRuntimeConfig = {
  clientId: string | null;
  clientSecret: string | null;
  tokenPath: string;
  timeZone: string;
};

export type GcalSyncControlOptions = {
  connection: SqliteConnection;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  createClient?: (config: GcalRuntimeConfig) => Promise<GcalClient>;
};

export class GcalSyncNotReadyError extends Error {
  constructor(readonly status: GcalSyncStatusData) {
    super(status.message);
  }
}

export function readGcalRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): GcalRuntimeConfig {
  return {
    clientId: trimToNull(env.GCAL_CLIENT_ID),
    clientSecret: trimToNull(env.GCAL_CLIENT_SECRET),
    tokenPath: trimToNull(env.CAIRN_TOKEN_PATH) ?? join(cwd, ".cairn", "gcal-token.json"),
    timeZone: trimToNull(env.CAIRN_TIME_ZONE) ?? "Asia/Seoul"
  };
}

export function getGcalSyncStatus(opts: GcalSyncControlOptions): GcalSyncStatusData {
  const config = readGcalRuntimeConfig(opts.env, opts.cwd);
  const configured = config.clientId !== null && config.clientSecret !== null;
  const tokenPresent = existsSync(config.tokenPath);
  const syncTokenPresent = readParam(opts.connection, GCAL_SYNC_TOKEN_KEY) !== null;
  const lastSyncAt = normalizeDateTime(readParam(opts.connection, GCAL_LAST_SYNC_AT_KEY));

  if (!configured) {
    return {
      state: "needs_config",
      configured,
      tokenPresent,
      syncTokenPresent,
      lastSyncAt,
      tokenPath: config.tokenPath,
      message: "Google Calendar OAuth 값이 설정되지 않았어."
    };
  }

  if (!tokenPresent) {
    return {
      state: "needs_auth",
      configured,
      tokenPresent,
      syncTokenPresent,
      lastSyncAt,
      tokenPath: config.tokenPath,
      message: "Google Calendar 인증 토큰이 아직 없어."
    };
  }

  return {
    state: "connected",
    configured,
    tokenPresent,
    syncTokenPresent,
    lastSyncAt,
    tokenPath: config.tokenPath,
    message: lastSyncAt ? "Google Calendar가 연결되어 있어." : "Google Calendar가 연결되어 있고 첫 동기화를 기다려."
  };
}

export async function runGcalSyncNow(opts: GcalSyncControlOptions): Promise<{ status: GcalSyncStatusData; result: GcalSyncResult }> {
  const status = getGcalSyncStatus(opts);
  if (status.state !== "connected") {
    throw new GcalSyncNotReadyError(status);
  }

  const config = readGcalRuntimeConfig(opts.env, opts.cwd);
  const createClient = opts.createClient ?? createDefaultClient;
  const client = await createClient(config);
  const result = await syncGcalPrimary({
    connection: opts.connection,
    client,
    timeZone: config.timeZone
  });

  return {
    status: getGcalSyncStatus(opts),
    result
  };
}

async function createDefaultClient(config: GcalRuntimeConfig): Promise<GcalClient> {
  if (config.clientId === null || config.clientSecret === null) {
    throw new Error("Google Calendar OAuth config is incomplete");
  }
  const creds: OAuthCredentials = { clientId: config.clientId, clientSecret: config.clientSecret };
  const store: TokenStore = { tokenPath: config.tokenPath };
  return createGcalClient(await loadTokens(creds, store));
}

function readParam(connection: SqliteConnection, key: string): string | null {
  const row = connection.db.select().from(params).where(eq(params.key, key)).get();
  return row?.value ?? null;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDateTime(value: string | null): string | null {
  if (value === null) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}
