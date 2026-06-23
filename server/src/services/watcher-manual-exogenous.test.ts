import { describe, expect, it } from "vitest";
import { buildManualExogenousView, emptyLogSummary, parseManualExogenousRule } from "./watcher-manual-exogenous.js";

describe("parseManualExogenousRule", () => {
  it("returns null for null input", () => {
    expect(parseManualExogenousRule(null)).toBeNull();
  });

  it("returns null for wrong type", () => {
    expect(parseManualExogenousRule(JSON.stringify({ type: "date_threshold", fireOn: "2026-01-01" }))).toBeNull();
  });

  it("returns null for invalid sourceStability", () => {
    expect(parseManualExogenousRule(JSON.stringify({ type: "manual_exogenous", sourceStability: "fast" }))).toBeNull();
  });

  it("parses valid rule with all fields", () => {
    const rule = {
      type: "manual_exogenous",
      sourceLabel: "비자 사이트",
      sourceUrl: "https://visa.example.com",
      sourceStability: "stable"
    };
    const result = parseManualExogenousRule(JSON.stringify(rule));
    expect(result).toEqual({
      type: "manual_exogenous",
      sourceLabel: "비자 사이트",
      sourceUrl: "https://visa.example.com",
      sourceStability: "stable"
    });
  });

  it("returns null sourceLabel/url if missing", () => {
    const result = parseManualExogenousRule(JSON.stringify({ type: "manual_exogenous", sourceStability: "volatile" }));
    expect(result?.sourceLabel).toBeNull();
    expect(result?.sourceUrl).toBeNull();
    expect(result?.sourceStability).toBe("volatile");
  });
});

describe("emptyLogSummary", () => {
  it("returns zero counts", () => {
    const s = emptyLogSummary();
    expect(s.manualLogCount).toBe(0);
    expect(s.missedSignalCount).toBe(0);
    expect(s.lastOutcome).toBeNull();
  });
});

describe("buildManualExogenousView", () => {
  it("merges rule + summary into view", () => {
    const rule = { type: "manual_exogenous" as const, sourceLabel: "L", sourceUrl: null, sourceStability: "stable" as const };
    const summary = emptyLogSummary();
    const view = buildManualExogenousView(rule, summary);
    expect(view.sourceLabel).toBe("L");
    expect(view.sourceStability).toBe("stable");
    expect(view.summary.manualLogCount).toBe(0);
  });
});
