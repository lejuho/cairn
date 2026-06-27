import { createSqliteConnection, runMigrations } from "../src/db/index.js";
import { createGmailClient } from "../src/gmail/client.js";
import { loadTokens } from "../src/gmail/auth.js";
import {
  resolveGmailCostSyncConfig,
  runGmailCostSync,
  type GmailCostSyncConfig
} from "../src/services/gmail-cost-sync.js";

function loadConfig(): GmailCostSyncConfig {
  try {
    return resolveGmailCostSyncConfig(process.env);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

const config = loadConfig();

const connection = createSqliteConnection(config.dbPath);
runMigrations(connection);

const auth = await loadTokens(
  { clientId: config.clientId, clientSecret: config.clientSecret },
  { tokenPath: config.tokenPath }
);
const client = createGmailClient(auth);

const result = await runGmailCostSync({
  connection,
  client,
  lookaheadDays: config.lookaheadDays,
  ...(config.now !== undefined ? { now: config.now } : {})
});

console.log(
  `Gmail cost sync complete: ${result.scanned} scanned, ${result.messages} messages, ` +
  `${result.updated} updated, ${result.skipped} skipped.`
);
