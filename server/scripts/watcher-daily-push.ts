import { createSqliteConnection, runMigrations } from "../src/db/index.js";
import { createTelegramClient } from "../src/telegram/client.js";
import { runWatcherDailyPush } from "../src/jobs/watcher-daily-push.js";

const dbPath = process.env.CAIRN_DB_PATH;
if (!dbPath) {
  console.error("Error: CAIRN_DB_PATH must be set.");
  process.exit(1);
}

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!botToken || !chatId) {
  console.error("Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set.");
  process.exit(1);
}

const connection = createSqliteConnection(dbPath);
runMigrations(connection);

const client = createTelegramClient({
  botToken,
  forceIpv4: process.env.TELEGRAM_FORCE_IPV4 === "1"
});
const sender = (message: string) =>
  client.sendMessage({ chatId, text: message }).then(() => undefined);

const result = await runWatcherDailyPush(connection.db, sender);

if (result.error) {
  console.error(`[watcher-push] delivery failed: ${result.error}`);
  connection.sqlite.close();
  process.exit(1);
}

console.log(`[watcher-push] sent=${result.sentCount} skipped=${result.skippedCount}`);
connection.sqlite.close();
process.exit(0);
