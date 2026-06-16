import { join } from "node:path";
import { createSqliteConnection, runMigrations } from "../src/db/index.js";
import { createGcalClient } from "../src/gcal/client.js";
import { loadTokens } from "../src/gcal/auth.js";
import { syncGcalPrimary } from "../src/gcal/sync.js";

const dbPath = process.env.CAIRN_DB_PATH;
if (!dbPath) {
  console.error("Error: CAIRN_DB_PATH must be set.");
  process.exit(1);
}

const clientId = process.env.GCAL_CLIENT_ID;
const clientSecret = process.env.GCAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Error: GCAL_CLIENT_ID and GCAL_CLIENT_SECRET must be set.");
  process.exit(1);
}

const tokenPath =
  process.env.CAIRN_TOKEN_PATH ??
  join(process.cwd(), ".cairn", "gcal-token.json");

const connection = createSqliteConnection(dbPath);
runMigrations(connection);

const auth = await loadTokens({ clientId, clientSecret }, { tokenPath });
const client = createGcalClient(auth);

const timeZone = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";
const result = await syncGcalPrimary({ connection, client, timeZone });

console.log(
  `Sync complete: ${result.upserted} upserted, ` +
  `${result.cancelled} cancelled, ${result.skipped} skipped.`
);
