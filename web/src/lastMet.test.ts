import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLastMet, LAST_MET_FALLBACK } from "./lastMet.js";

afterEach(() => vi.restoreAllMocks());

describe("formatLastMet", () => {
  it("returns the explicit fallback for null", () => {
    expect(formatLastMet(null)).toBe(LAST_MET_FALLBACK);
  });

  it("returns the explicit fallback for malformed input", () => {
    expect(formatLastMet("not-a-date")).toBe(LAST_MET_FALLBACK);
    expect(formatLastMet("")).toBe(LAST_MET_FALLBACK);
  });

  it("calls toLocaleString with ko-KR and both hour and minute options", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleString");
    formatLastMet("2026-06-01T11:00:00+09:00");
    expect(spy).toHaveBeenCalledOnce();
    const [locale, opts] = spy.mock.calls[0] as [string, Intl.DateTimeFormatOptions];
    expect(locale).toBe("ko-KR");
    expect(opts).toMatchObject({ hour: expect.anything(), minute: expect.anything() });
  });

  it("does not return the fallback for a valid ISO string", () => {
    const result = formatLastMet("2026-06-01T11:00:00+09:00");
    expect(result).not.toBe(LAST_MET_FALLBACK);
    // The result includes the year regardless of locale environment.
    expect(result).toContain("2026");
  });

  it("handles Z-suffix timestamps without returning fallback", () => {
    const result = formatLastMet("2026-06-01T02:00:00Z");
    expect(result).not.toBe(LAST_MET_FALLBACK);
  });
});

describe("LAST_MET_FALLBACK export", () => {
  it("is the expected Korean copy", () => {
    expect(LAST_MET_FALLBACK).toBe("만남 기록 없음");
  });
});
