import { describe, expect, it } from "vitest";
import { readMapConfig } from "./config.js";

describe("readMapConfig (cycle-72)", () => {
  it("defaults to disabled when MAP_PROVIDER is absent", () => {
    const r = readMapConfig({});
    expect(r).toEqual({ ok: true, config: { provider: "disabled" } });
  });

  it("treats blank/whitespace MAP_PROVIDER as disabled", () => {
    expect(readMapConfig({ MAP_PROVIDER: "   " })).toEqual({ ok: true, config: { provider: "disabled" } });
  });

  it("flags an unsupported provider id as a config error", () => {
    const r = readMapConfig({ MAP_PROVIDER: "mapbox" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("config_error");
  });

  it("google with missing or blank key is a typed config error (not a crash)", () => {
    expect(readMapConfig({ MAP_PROVIDER: "google" }).ok).toBe(false);
    const blank = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("config_error");
  });

  it("google with a key returns config with default base URL + default timeout", () => {
    const r = readMapConfig({ MAP_PROVIDER: " google ", MAP_PROVIDER_API_KEY: "  KEY123  " });
    expect(r.ok).toBe(true);
    if (r.ok && r.config.provider === "google") {
      expect(r.config.apiKey).toBe("KEY123"); // trimmed
      expect(r.config.baseUrl).toBe("https://maps.googleapis.com");
      expect(r.config.timeoutMs).toBe(5000);
    }
  });

  it("honors a custom base URL", () => {
    const r = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "K", MAP_PROVIDER_BASE_URL: "https://mock.local" });
    if (r.ok && r.config.provider === "google") expect(r.config.baseUrl).toBe("https://mock.local");
  });

  it("clamps the timeout to [1000, 15000] and falls back on blank/invalid", () => {
    const big = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "K", MAP_PROVIDER_TIMEOUT_MS: "999999" });
    const small = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "K", MAP_PROVIDER_TIMEOUT_MS: "5" });
    const blank = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "K", MAP_PROVIDER_TIMEOUT_MS: "  " });
    const bad = readMapConfig({ MAP_PROVIDER: "google", MAP_PROVIDER_API_KEY: "K", MAP_PROVIDER_TIMEOUT_MS: "abc" });
    if (big.ok && big.config.provider === "google") expect(big.config.timeoutMs).toBe(15000);
    if (small.ok && small.config.provider === "google") expect(small.config.timeoutMs).toBe(1000);
    if (blank.ok && blank.config.provider === "google") expect(blank.config.timeoutMs).toBe(5000);
    if (bad.ok && bad.config.provider === "google") expect(bad.config.timeoutMs).toBe(5000);
  });
});
