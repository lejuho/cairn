import { describe, expect, it } from "vitest";
import {
  PlaceCandidateSchema,
  PlaceSearchQuerySchema,
  PlaceSearchResponseSchema
} from "./placeSearch.js";

const CANDIDATE = {
  title: "스타벅스 강남대로점",
  category: "카페",
  address: "서울특별시 강남구 역삼동 814-3",
  roadAddress: "서울특별시 강남구 강남대로 390",
  description: null,
  naverUrl: "https://map.naver.com/p/search/%EC%8A%A4%ED%83%80%EB%B2%85%EC%8A%A4",
  locationText: "스타벅스 강남대로점 · 서울특별시 강남구 강남대로 390"
};

describe("Place search schemas (cycle-79)", () => {
  it("accepts a sanitized candidate", () => {
    expect(PlaceCandidateSchema.safeParse(CANDIDATE).success).toBe(true);
  });

  it("rejects raw provider / coordinate / secret / scoring / auto-apply fields (strict)", () => {
    for (const inject of [
      { mapx: "1271234567" },
      { mapy: "375045700" },
      { raw: { items: [] } },
      { items: [] },
      { clientSecret: "secret" },
      { errorMessage: "bad" },
      { score: 9 },
      { recommendation: "save" },
      { autoApply: true },
      { latitude: 37.5 }
    ]) {
      expect(PlaceCandidateSchema.safeParse({ ...CANDIDATE, ...inject }).success).toBe(false);
    }
  });

  it("rejects a non-URL naverUrl", () => {
    expect(PlaceCandidateSchema.safeParse({ ...CANDIDATE, naverUrl: "not a url" }).success).toBe(false);
    expect(PlaceCandidateSchema.safeParse({ ...CANDIDATE, naverUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("query schema requires 2..100 trimmed chars", () => {
    expect(PlaceSearchQuerySchema.safeParse({ query: "강남" }).success).toBe(true);
    expect(PlaceSearchQuerySchema.safeParse({ query: " a " }).success).toBe(false);
    expect(PlaceSearchQuerySchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(PlaceSearchQuerySchema.safeParse({ query: "강남", extra: 1 }).success).toBe(false);
  });

  it("response union accepts success + typed error and caps candidates at 5", () => {
    expect(PlaceSearchResponseSchema.safeParse({ ok: true, data: { provider: "naver", candidates: [CANDIDATE] } }).success).toBe(true);
    expect(PlaceSearchResponseSchema.safeParse({ ok: false, error: { code: "disabled", message: "x" } }).success).toBe(true);
    expect(PlaceSearchResponseSchema.safeParse({ ok: false, error: { code: "scraped", message: "x" } }).success).toBe(false);
    expect(PlaceSearchResponseSchema.safeParse({ ok: true, data: { provider: "naver", candidates: Array(6).fill(CANDIDATE) } }).success).toBe(false);
  });
});
