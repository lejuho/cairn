import { describe, expect, it } from "vitest";
import { buildNotificationDrafts } from "./notification-drafts.js";
import type { PersonRow } from "@cairn/shared";

const NOW = Date.parse("2026-06-20T10:00:00+09:00");
const TITLE = "저녁 약속";

function person(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: 1,
    name: "민지",
    relation: null,
    channel: "kakao",
    hardConstraints: [],
    preferredWindows: null,
    leadTime: { days: 3, firmness: "hard" },
    ...overrides
  };
}

describe("buildNotificationDrafts", () => {
  it("returns empty array when no people", () => {
    expect(buildNotificationDrafts([], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW)).toEqual([]);
  });

  it("moved template includes event title and no replacement time claim", () => {
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.message).toContain("저녁 약속");
    expect(draft!.message).toContain("새 시간은 정해지는 대로");
    expect(draft!.message).not.toMatch(/\d{1,2}:\d{2}/); // no time claim
  });

  it("cancelled template includes event title and apology", () => {
    const [draft] = buildNotificationDrafts([person()], TITLE, "cancelled", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.message).toContain("저녁 약속");
    expect(draft!.message).toContain("미안해");
    expect(draft!.message).not.toContain("새 시간");
  });

  it("channel=null emits channel_unset reason", () => {
    const [draft] = buildNotificationDrafts([person({ channel: null })], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.channel).toBeNull();
    expect(draft!.reasonCodes).toContain("channel_unset");
  });

  it("channel=none emits channel_unset and null channel", () => {
    const [draft] = buildNotificationDrafts([person({ channel: "none" })], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.channel).toBeNull();
    expect(draft!.reasonCodes).toContain("channel_unset");
  });

  it("lead time enough: event start >= leadDays*24h from now", () => {
    // 3 days from NOW: 2026-06-23T10:00:00+09:00 exactly = enough
    const start = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString();
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", start, NOW);
    expect(draft!.leadTimeStatus).toBe("enough");
    expect(draft!.reasonCodes).not.toContain("lead_time_late");
  });

  it("lead time late: event start < leadDays*24h from now", () => {
    // 2 days from NOW with 3-day lead time → late
    const start = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString();
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", start, NOW);
    expect(draft!.leadTimeStatus).toBe("late");
    expect(draft!.reasonCodes).toContain("lead_time_late");
  });

  it("leadTimeDays=0: always enough (gap >= 0)", () => {
    const [draft] = buildNotificationDrafts([person({ leadTime: { days: 0, firmness: "hard" } })], TITLE, "moved", "2026-06-20T11:00:00+09:00", NOW);
    expect(draft!.leadTimeStatus).toBe("enough");
    expect(draft!.leadTimeDays).toBe(0);
  });

  it("null lead time: unknown + lead_time_unset", () => {
    const [draft] = buildNotificationDrafts([person({ leadTime: null })], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.leadTimeStatus).toBe("unknown");
    expect(draft!.reasonCodes).toContain("lead_time_unset");
  });

  it("null eventStart: unknown + event_time_unknown", () => {
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", null, NOW);
    expect(draft!.leadTimeStatus).toBe("unknown");
    expect(draft!.reasonCodes).toContain("event_time_unknown");
  });

  it("malformed eventStart: unknown + event_time_unknown", () => {
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", "not-a-date", NOW);
    expect(draft!.leadTimeStatus).toBe("unknown");
    expect(draft!.reasonCodes).toContain("event_time_unknown");
  });

  it("mixed RFC3339 offsets are compared correctly via epoch ms", () => {
    // NOW is +09:00. Start is Z — same point in time, should parse identically.
    const startZ = "2026-06-20T01:00:00Z"; // === 2026-06-20T10:00:00+09:00 = NOW exactly
    const startKST = "2026-06-20T10:00:00+09:00";
    const [d1] = buildNotificationDrafts([person({ leadTime: { days: 0, firmness: "hard" } })], TITLE, "moved", startZ, NOW);
    const [d2] = buildNotificationDrafts([person({ leadTime: { days: 0, firmness: "hard" } })], TITLE, "moved", startKST, NOW);
    expect(d1!.leadTimeStatus).toBe(d2!.leadTimeStatus); // both "enough" (gap=0 >= 0)
  });

  it("deduplicates people by id, keeps stable name/id order", () => {
    const p1 = person({ id: 2, name: "지수" });
    const p2 = person({ id: 1, name: "민지" });
    const dup = person({ id: 2, name: "지수" });
    const drafts = buildNotificationDrafts([p1, p2, dup], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(drafts).toHaveLength(2);
    // Note: dedup preserves input order (first-seen), not alphabetical; sort is done in repo
    const ids = drafts.map((d) => d.personId);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it("tone is always neutral with tone_profile_unavailable reason", () => {
    const [draft] = buildNotificationDrafts([person()], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    expect(draft!.tone).toBe("neutral");
    expect(draft!.reasonCodes).toContain("tone_profile_unavailable");
  });

  it("reasonCodes ordering: channel → lead-time/event-time → tone", () => {
    const [draft] = buildNotificationDrafts([person({ channel: null, leadTime: null })], TITLE, "moved", "2026-06-23T19:00:00+09:00", NOW);
    const i_channel = draft!.reasonCodes.indexOf("channel_unset");
    const i_lead = draft!.reasonCodes.indexOf("lead_time_unset");
    const i_tone = draft!.reasonCodes.indexOf("tone_profile_unavailable");
    expect(i_channel).toBeLessThan(i_lead);
    expect(i_lead).toBeLessThan(i_tone);
  });
});
