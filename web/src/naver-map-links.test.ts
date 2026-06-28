import { describe, expect, it } from "vitest";
import { naverCoordToken, naverSearchUrl, naverTransitDirectionsUrl } from "./naver-map-links.js";

describe("naverCoordToken (cycle-77)", () => {
  it("encodes the observed plan sample coordinates", () => {
    // Locks the reverse-engineered base62 formula so a refactor can't drift.
    expect(naverCoordToken(127.0248712)).toBe("3zjD4Y");
    expect(naverCoordToken(37.5045700)).toBe("2AJrSI");
    expect(naverCoordToken(127.0339086)).toBe("3zk0AC");
    expect(naverCoordToken(37.5073233)).toBe("2AJz2N");
  });

  it("returns null for NaN / Infinity / out-of-range coordinates", () => {
    expect(naverCoordToken(Number.NaN)).toBeNull();
    expect(naverCoordToken(Number.POSITIVE_INFINITY)).toBeNull();
    expect(naverCoordToken(-Infinity)).toBeNull();
    expect(naverCoordToken(181)).toBeNull();
    expect(naverCoordToken(-200)).toBeNull();
  });
});

describe("naverSearchUrl (cycle-77)", () => {
  it("builds a Naver search URL with a fully encoded query (no key, safe path)", () => {
    expect(naverSearchUrl("강남역, 2번 출구")).toBe(`https://map.naver.com/p/search/${encodeURIComponent("강남역, 2번 출구")}`);
    const url = naverSearchUrl("a/b, c");
    expect(url).toContain("map.naver.com/p/search/");
    expect(url).not.toContain("/b,"); // comma + slash are percent-encoded, path not corrupted
    expect(url).not.toMatch(/key=|googleapis|ncloud/);
  });
});

describe("naverTransitDirectionsUrl (cycle-77)", () => {
  it("builds a /p/directions transit URL with lon-first tokens, encoded labels, and deterministic order", () => {
    const url = naverTransitDirectionsUrl(
      { lat: 37.5045700, lng: 127.0248712, label: "출발지" },
      { lat: 37.5073233, lng: 127.0339086, label: "도착지" }
    );
    expect(url).toBe(
      `https://map.naver.com/p/directions/3zjD4Y,2AJrSI,${encodeURIComponent("출발지")},,/3zk0AC,2AJz2N,${encodeURIComponent("도착지")},,/-/transit?c=15.00,0,0,0,dh`
    );
  });

  it("falls back to an empty label segment when the label is missing", () => {
    const url = naverTransitDirectionsUrl({ lat: 37.5, lng: 127.0 }, { lat: 37.6, lng: 127.1, label: null });
    expect(url).toContain("/p/directions/");
    expect(url).toContain(",,/"); // empty label + empty placeholder fields
    expect(url).toContain("/-/transit?c=15.00,0,0,0,dh");
  });

  it("returns null when either endpoint has an invalid coordinate (fail soft)", () => {
    expect(naverTransitDirectionsUrl({ lat: Number.NaN, lng: 127.0 }, { lat: 37.6, lng: 127.1 })).toBeNull();
    expect(naverTransitDirectionsUrl({ lat: 37.5, lng: 127.0 }, { lat: 37.6, lng: 999 })).toBeNull();
  });

  it("rejects out-of-range latitude with axis-specific WGS84 bounds (review-v1 ISSUE-1)", () => {
    // latitude is [-90,90] — an impossible latitude must NOT produce a directions link
    // even though it is inside the broad [-180,180] token-formula range.
    expect(naverTransitDirectionsUrl({ lat: 120, lng: 127.0 }, { lat: 37.6, lng: 127.1 })).toBeNull();
    expect(naverTransitDirectionsUrl({ lat: 37.5, lng: 127.0 }, { lat: -120, lng: 127.1 })).toBeNull();
    // a valid latitude at the boundary still works
    expect(naverTransitDirectionsUrl({ lat: 90, lng: 180 }, { lat: -90, lng: -180 })).not.toBeNull();
  });
});
