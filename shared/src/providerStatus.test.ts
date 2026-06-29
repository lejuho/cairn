import { describe, it, expect } from "vitest";
import { ProviderStatusRowSchema, ProviderStatusResponseSchema } from "./providerStatus.js";

const CLEAN_GOOGLE = {
  id: "google", label: "Google", state: "connected", code: "ok",
  checkedAt: "2026-06-29T00:00:00.000Z", ttlSeconds: 300, message: "연결됨"
};
const CLEAN_NAVER = {
  id: "naver", label: "Naver", state: "disabled", code: "disabled",
  checkedAt: "2026-06-29T00:00:00.000Z", ttlSeconds: 300, message: "비활성"
};

describe("ProviderStatus schema (cycle-82)", () => {
  it("accepts two clean provider rows", () => {
    expect(ProviderStatusRowSchema.safeParse(CLEAN_GOOGLE).success).toBe(true);
    expect(ProviderStatusRowSchema.safeParse(CLEAN_NAVER).success).toBe(true);
    expect(ProviderStatusResponseSchema.safeParse({ ok: true, data: { providers: [CLEAN_GOOGLE, CLEAN_NAVER] } }).success).toBe(true);
  });

  it("rejects raw/secret/leaky fields (strict)", () => {
    for (const leak of [
      { apiKey: "AIza..." }, { clientSecret: "secret" }, { headers: { "X-Naver-Client-Id": "x" } },
      { errorMessage: "Google said quota exceeded" }, { raw: { items: [] } }, { url: "https://maps.googleapis.com/..." }
    ]) {
      expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, ...leak }).success).toBe(false);
    }
  });

  it("rejects an out-of-enum state/code/id and a non-positive ttl", () => {
    expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, state: "down" }).success).toBe(false);
    expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, code: "quota" }).success).toBe(false);
    expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, id: "kakao" }).success).toBe(false);
    expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, ttlSeconds: 0 }).success).toBe(false);
    expect(ProviderStatusRowSchema.safeParse({ ...CLEAN_GOOGLE, checkedAt: "not-a-date" }).success).toBe(false);
  });

  it("rejects unknown top-level keys on the response envelope", () => {
    expect(ProviderStatusResponseSchema.safeParse({ ok: true, data: { providers: [] }, extra: 1 }).success).toBe(false);
    expect(ProviderStatusResponseSchema.safeParse({ ok: true, data: { providers: [], leaked: "x" } }).success).toBe(false);
  });
});
