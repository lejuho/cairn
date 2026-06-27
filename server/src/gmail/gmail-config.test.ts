import { describe, expect, it } from "vitest";
import { resolveGmailAuthConfig } from "./auth.js";
import { resolveGmailCostSyncConfig } from "../services/gmail-cost-sync.js";

const CWD = "/home/test";
const OAUTH = { GMAIL_CLIENT_ID: "id-1", GMAIL_CLIENT_SECRET: "secret-1" };

describe("resolveGmailAuthConfig", () => {
  it("throws when OAuth credentials are missing", () => {
    expect(() => resolveGmailAuthConfig({}, CWD)).toThrow(/GMAIL_CLIENT_ID/);
    expect(() => resolveGmailAuthConfig({ GMAIL_CLIENT_ID: "id-1" }, CWD)).toThrow(/GMAIL_CLIENT_SECRET|GMAIL_CLIENT_ID/);
  });

  it("defaults the token path under .cairn/", () => {
    const cfg = resolveGmailAuthConfig({ ...OAUTH }, CWD);
    expect(cfg.tokenPath).toBe("/home/test/.cairn/gmail-token.json");
  });

  it("honors CAIRN_GMAIL_TOKEN_PATH override", () => {
    const cfg = resolveGmailAuthConfig({ ...OAUTH, CAIRN_GMAIL_TOKEN_PATH: "/custom/tok.json" }, CWD);
    expect(cfg.tokenPath).toBe("/custom/tok.json");
  });
});

describe("resolveGmailCostSyncConfig", () => {
  it("throws when CAIRN_DB_PATH is missing (before DB access)", () => {
    expect(() => resolveGmailCostSyncConfig({ ...OAUTH }, CWD)).toThrow(/CAIRN_DB_PATH/);
  });

  it("throws when Gmail OAuth env is missing (before DB access)", () => {
    expect(() => resolveGmailCostSyncConfig({ CAIRN_DB_PATH: "/db.sqlite3" }, CWD)).toThrow(/GMAIL_CLIENT_ID/);
  });

  it("resolves a full config with defaults", () => {
    const cfg = resolveGmailCostSyncConfig({ ...OAUTH, CAIRN_DB_PATH: "/db.sqlite3" }, CWD);
    expect(cfg).toEqual({
      dbPath: "/db.sqlite3",
      clientId: "id-1",
      clientSecret: "secret-1",
      tokenPath: "/home/test/.cairn/gmail-token.json",
      lookaheadDays: 14
    });
  });

  it("honors lookahead, token path, and now overrides", () => {
    const cfg = resolveGmailCostSyncConfig(
      {
        ...OAUTH,
        CAIRN_DB_PATH: "/db.sqlite3",
        CAIRN_GMAIL_TOKEN_PATH: "/custom/tok.json",
        CAIRN_GMAIL_LOOKAHEAD_DAYS: "30",
        CAIRN_GMAIL_NOW: "2026-06-16T00:00:00+09:00"
      },
      CWD
    );
    expect(cfg.tokenPath).toBe("/custom/tok.json");
    expect(cfg.lookaheadDays).toBe(30);
    expect(cfg.now).toBe("2026-06-16T00:00:00+09:00");
  });

  it("falls back to the default lookahead when the value is invalid", () => {
    const cfg = resolveGmailCostSyncConfig(
      { ...OAUTH, CAIRN_DB_PATH: "/db.sqlite3", CAIRN_GMAIL_LOOKAHEAD_DAYS: "-5" },
      CWD
    );
    expect(cfg.lookaheadDays).toBe(14);
  });
});
