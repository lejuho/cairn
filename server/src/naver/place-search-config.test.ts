import { describe, expect, it } from "vitest";
import { readPlaceSearchConfig } from "./place-search-config.js";

describe("readPlaceSearchConfig (cycle-79)", () => {
  it("defaults to disabled when credentials are missing or blank (fail-soft, no crash)", () => {
    expect(readPlaceSearchConfig({}).config.provider).toBe("disabled");
    expect(readPlaceSearchConfig({ NAVER_SEARCH_CLIENT_ID: "id" }).config.provider).toBe("disabled");
    expect(readPlaceSearchConfig({ NAVER_SEARCH_CLIENT_ID: "  ", NAVER_SEARCH_CLIENT_SECRET: "  " }).config.provider).toBe("disabled");
  });

  it("enables naver with both credentials, default base url, and a clamped timeout", () => {
    const r = readPlaceSearchConfig({ NAVER_SEARCH_CLIENT_ID: "id", NAVER_SEARCH_CLIENT_SECRET: "secret" });
    expect(r.config).toMatchObject({ provider: "naver", clientId: "id", clientSecret: "secret", baseUrl: "https://openapi.naver.com" });
    if (r.config.provider === "naver") expect(r.config.timeoutMs).toBe(5000);
  });

  it("clamps a hostile timeout into [1000, 15000]", () => {
    const lo = readPlaceSearchConfig({ NAVER_SEARCH_CLIENT_ID: "id", NAVER_SEARCH_CLIENT_SECRET: "s", NAVER_SEARCH_TIMEOUT_MS: "10" });
    const hi = readPlaceSearchConfig({ NAVER_SEARCH_CLIENT_ID: "id", NAVER_SEARCH_CLIENT_SECRET: "s", NAVER_SEARCH_TIMEOUT_MS: "999999" });
    if (lo.config.provider === "naver") expect(lo.config.timeoutMs).toBe(1000);
    if (hi.config.provider === "naver") expect(hi.config.timeoutMs).toBe(15000);
  });
});
