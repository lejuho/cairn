import { resolveGmailAuthConfig, runAuth, type GmailAuthConfig } from "../src/gmail/auth.js";

function loadConfig(): GmailAuthConfig {
  try {
    return resolveGmailAuthConfig(process.env);
  } catch (err) {
    console.error(
      `Error: ${(err as Error).message}\n` +
      "Create OAuth credentials at https://console.cloud.google.com/apis/credentials\n" +
      "and export them before running this command."
    );
    process.exit(1);
  }
}

const config = loadConfig();

await runAuth(
  { clientId: config.clientId, clientSecret: config.clientSecret },
  { tokenPath: config.tokenPath }
);
