import { describe, expect, it } from "vitest";
import {
  AuthoredLeadTimeSchema,
  AuthoredPreferredWindowsSchema,
  UpdatePersonProfileRequestSchema
} from "./people.js";

describe("AuthoredPreferredWindowsSchema", () => {
  it("accepts valid windows", () => {
    const r = AuthoredPreferredWindowsSchema.safeParse({ weekdays: ["monday"], periods: ["morning"], firmness: "hard" });
    expect(r.success).toBe(true);
  });

  it("rejects empty weekdays", () => {
    const r = AuthoredPreferredWindowsSchema.safeParse({ weekdays: [], periods: ["morning"], firmness: "hard" });
    expect(r.success).toBe(false);
  });

  it("rejects empty periods", () => {
    const r = AuthoredPreferredWindowsSchema.safeParse({ weekdays: ["monday"], periods: [], firmness: "hard" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid period", () => {
    const r = AuthoredPreferredWindowsSchema.safeParse({ weekdays: ["monday"], periods: ["noon"], firmness: "hard" });
    expect(r.success).toBe(false);
  });

  it("rejects wrong firmness", () => {
    const r = AuthoredPreferredWindowsSchema.safeParse({ weekdays: ["monday"], periods: ["morning"], firmness: "soft" });
    expect(r.success).toBe(false);
  });
});

describe("AuthoredLeadTimeSchema", () => {
  it("accepts zero", () => {
    const r = AuthoredLeadTimeSchema.safeParse({ days: 0, firmness: "hard" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.days).toBe(0);
  });

  it("accepts 30", () => {
    expect(AuthoredLeadTimeSchema.safeParse({ days: 30, firmness: "hard" }).success).toBe(true);
  });

  it("rejects negative days", () => {
    expect(AuthoredLeadTimeSchema.safeParse({ days: -1, firmness: "hard" }).success).toBe(false);
  });

  it("rejects 31 days", () => {
    expect(AuthoredLeadTimeSchema.safeParse({ days: 31, firmness: "hard" }).success).toBe(false);
  });

  it("rejects non-integer days", () => {
    expect(AuthoredLeadTimeSchema.safeParse({ days: 1.5, firmness: "hard" }).success).toBe(false);
  });
});

describe("UpdatePersonProfileRequestSchema", () => {
  const base = {
    preferredWeekdays: ["monday", "wednesday"],
    preferredPeriods: ["evening"],
    leadTimeDays: 3,
    channel: "kakao",
    unavailableWeekdays: ["friday"]
  } as const;

  it("accepts a valid complete profile", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse(base).success).toBe(true);
  });

  it("accepts all-empty preferred windows (clear)", () => {
    const r = UpdatePersonProfileRequestSchema.safeParse({
      ...base,
      preferredWeekdays: [],
      preferredPeriods: []
    });
    expect(r.success).toBe(true);
  });

  it("accepts null leadTimeDays (clear)", () => {
    const r = UpdatePersonProfileRequestSchema.safeParse({ ...base, leadTimeDays: null });
    expect(r.success).toBe(true);
  });

  it("accepts leadTimeDays=0 (same-day explicit value)", () => {
    const r = UpdatePersonProfileRequestSchema.safeParse({ ...base, leadTimeDays: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.leadTimeDays).toBe(0);
  });

  it("rejects invalid channel", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({ ...base, channel: "discord" }).success).toBe(false);
  });

  it("rejects invalid period", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({ ...base, preferredPeriods: ["midday" as never] }).success).toBe(false);
  });

  it("rejects leadTimeDays > 30", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({ ...base, leadTimeDays: 31 }).success).toBe(false);
  });

  it("rejects non-integer leadTimeDays", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({ ...base, leadTimeDays: 1.5 }).success).toBe(false);
  });

  it("rejects half-empty windows — weekdays present, periods absent", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({
      ...base, preferredWeekdays: ["monday"], preferredPeriods: []
    }).success).toBe(false);
  });

  it("rejects half-empty windows — periods present, weekdays absent", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({
      ...base, preferredWeekdays: [], preferredPeriods: ["morning"]
    }).success).toBe(false);
  });

  it("rejects overlap — a day in both preferred and unavailable", () => {
    expect(UpdatePersonProfileRequestSchema.safeParse({
      ...base,
      preferredWeekdays: ["monday"],
      unavailableWeekdays: ["monday"]
    }).success).toBe(false);
  });
});
