import { join } from "node:path";
import { runAuth } from "../src/gcal/auth.js";

const clientId = process.env.GCAL_CLIENT_ID;
const clientSecret = process.env.GCAL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Error: GCAL_CLIENT_ID and GCAL_CLIENT_SECRET must be set.\n" +
    "Create OAuth credentials at https://console.cloud.google.com/apis/credentials\n" +
    "and export them before running this command."
  );
  process.exit(1);
}

const tokenPath =
  process.env.CAIRN_TOKEN_PATH ??
  join(process.cwd(), ".cairn", "gcal-token.json");

await runAuth(
  { clientId, clientSecret },
  { tokenPath }
);
