import { describe, expect, it } from "vitest";
import { buildMirrorDiary } from "./mirror-diary.js";
import type { MirrorSourceRow } from "../repositories/mirror.js";

const RANGE = { from: "2026-06-01", to: "2026-06-30" };

function row(overrides: Partial<MirrorSourceRow> = {}): MirrorSourceRow {
  return {
    annotationId: 1,
    eventId: 10,
    eventTitle: "팀 회의",
    eventType: "meet",
    outcome: "moved",
    reasonTags: null,
    reasonText: "회의 장소 변경",
    loggedAt: "2026-06-21 09:00:00",
    eventStart: "2026-06-21T10:00:00+09:00",
    threadId: null,
    threadName: null,
    cancelMoney: null,
    cancelSocial: null,
    cancelEffort: null,
    cancelWindow: null,
    ...overrides
  };
}

describe("buildMirrorDiary", () => {
  it("returns empty days for no rows", () => {
    const result = buildMirrorDiary([], RANGE);
    expect(result.days).toHaveLength(0);
    expect(result.sampleStatus).toBe("low_sample");
  });

  it("filters by loggedAt date inside range", () => {
    const inside = row({ loggedAt: "2026-06-15 09:00:00" });
    const outside = row({ annotationId: 2, loggedAt: "2026-07-01 09:00:00" });
    const result = buildMirrorDiary([inside, outside], RANGE);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]!.date).toBe("2026-06-15");
  });

  it("excludes orphan rows (null eventId)", () => {
    const orphan = row({ eventId: null });
    const result = buildMirrorDiary([orphan], RANGE);
    expect(result.days).toHaveLength(0);
  });

  it("excludes rows with null eventTitle", () => {
    const r = row({ eventTitle: null });
    expect(buildMirrorDiary([r], RANGE).days).toHaveLength(0);
  });

  it("excludes rows with null loggedAt", () => {
    const r = row({ loggedAt: null });
    expect(buildMirrorDiary([r], RANGE).days).toHaveLength(0);
  });

  it("groups entries by date, newest date first", () => {
    const r1 = row({ annotationId: 1, loggedAt: "2026-06-20 09:00:00" });
    const r2 = row({ annotationId: 2, loggedAt: "2026-06-21 09:00:00" });
    const result = buildMirrorDiary([r2, r1], RANGE);
    expect(result.days[0]!.date).toBe("2026-06-21");
    expect(result.days[1]!.date).toBe("2026-06-20");
  });

  it("within a day, preserves repo order (loggedAt desc, id desc)", () => {
    const r1 = row({ annotationId: 5, loggedAt: "2026-06-21 08:00:00" });
    const r2 = row({ annotationId: 6, loggedAt: "2026-06-21 10:00:00" });
    const result = buildMirrorDiary([r2, r1], RANGE);
    const entries = result.days[0]!.entries;
    expect(entries[0]!.annotationId).toBe(6);
    expect(entries[1]!.annotationId).toBe(5);
  });

  it("headline is first non-empty reasonText for that day", () => {
    const r1 = row({ annotationId: 1, loggedAt: "2026-06-21 10:00:00", reasonText: null });
    const r2 = row({ annotationId: 2, loggedAt: "2026-06-21 09:00:00", reasonText: "이유 있음" });
    const result = buildMirrorDiary([r1, r2], RANGE);
    expect(result.days[0]!.headline).toBe("이유 있음");
  });

  it("headline is null when all reasonTexts are empty/null", () => {
    const r = row({ reasonText: null });
    const result = buildMirrorDiary([r], RANGE);
    expect(result.days[0]!.headline).toBeNull();
  });

  it("whitespace-only reasonText treated as empty: depth=automatic, headline=null", () => {
    const r = row({ reasonText: "   " });
    const result = buildMirrorDiary([r], RANGE);
    expect(result.days[0]!.entries[0]!.depth).toBe("automatic");
    expect(result.days[0]!.headline).toBeNull();
  });

  it("non-empty reasonText yields depth=semi_auto", () => {
    const r = row({ reasonText: "회의 장소 변경" });
    const result = buildMirrorDiary([r], RANGE);
    expect(result.days[0]!.entries[0]!.depth).toBe("semi_auto");
  });

  it("sampleStatus=low_sample when total entries < 3", () => {
    const r1 = row({ annotationId: 1, loggedAt: "2026-06-01 09:00:00" });
    const r2 = row({ annotationId: 2, loggedAt: "2026-06-02 09:00:00" });
    expect(buildMirrorDiary([r1, r2], RANGE).sampleStatus).toBe("low_sample");
    const r3 = row({ annotationId: 3, loggedAt: "2026-06-03 09:00:00" });
    expect(buildMirrorDiary([r1, r2, r3], RANGE).sampleStatus).toBe("ok");
  });

  it("thread is populated when threadId and threadName present", () => {
    const r = row({ threadId: 7, threadName: "프로젝트 A" });
    const result = buildMirrorDiary([r], RANGE);
    expect(result.days[0]!.entries[0]!.thread).toEqual({ id: 7, name: "프로젝트 A" });
  });

  it("thread is null when threadId is null", () => {
    const r = row({ threadId: null, threadName: null });
    const result = buildMirrorDiary([r], RANGE);
    expect(result.days[0]!.entries[0]!.thread).toBeNull();
  });

  it("reasonTags parsed from JSON array", () => {
    const r = row({ reasonTags: JSON.stringify(["conflict_resolution", "location"]) });
    const entry = buildMirrorDiary([r], RANGE).days[0]!.entries[0]!;
    expect(entry.reasonTags).toEqual(["conflict_resolution", "location"]);
  });

  it("malformed reasonTags treated as empty array", () => {
    const r = row({ reasonTags: "not-json" });
    expect(buildMirrorDiary([r], RANGE).days[0]!.entries[0]!.reasonTags).toEqual([]);
  });

  it("contextLabel for moved outcome", () => {
    const r = row({ outcome: "moved" });
    expect(buildMirrorDiary([r], RANGE).days[0]!.entries[0]!.contextLabel).toBe("팀 회의 / 이동");
  });

  it("contextLabel for done outcome", () => {
    const r = row({ outcome: "done" });
    expect(buildMirrorDiary([r], RANGE).days[0]!.entries[0]!.contextLabel).toBe("팀 회의 / 완료");
  });
});
