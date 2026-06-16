import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.CAIRN_DB_PATH ?? "cairn.sqlite3"
  },
  strict: true,
  verbose: true
});
