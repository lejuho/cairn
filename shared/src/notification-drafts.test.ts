import { describe, expect, it } from "vitest";
import { NotificationDraftSchema, NotificationLeadTimeStatusSchema } from "./notification-drafts.js";

describe("NotificationLeadTimeStatusSchema", () => {
  it("accepts valid statuses", () => {
    for (const s of ["enough", "late", "unknown"]) {
      expect(NotificationLeadTimeStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects invalid status", () => {
    expect(() => NotificationLeadTimeStatusSchema.parse("on_time")).toThrow();
  });
});

describe("NotificationDraftSchema", () => {
  const VALID = {
    personId: 7,
    personName: "민지",
    channel: "kakao",
    leadTimeDays: 3,
    leadTimeStatus: "enough",
    tone: "neutral",
    message: "민지님, \"저녁\" 일정 변경이 필요해.",
    reasonCodes: ["tone_profile_unavailable"]
  };

  it("accepts a valid draft", () => {
    expect(() => NotificationDraftSchema.parse(VALID)).not.toThrow();
  });

  it("accepts null channel and null leadTimeDays", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, channel: null, leadTimeDays: null })).not.toThrow();
  });

  it("rejects unknown channel", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, channel: "whatsapp" })).toThrow();
  });

  it("rejects invalid leadTimeStatus", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, leadTimeStatus: "pending" })).toThrow();
  });

  it("rejects non-neutral tone", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, tone: "warm" })).toThrow();
  });

  it("rejects empty message", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, message: "" })).toThrow();
  });

  it("rejects unknown reasonCode", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, reasonCodes: ["delivery_failed"] })).toThrow();
  });

  it("accepts leadTimeDays = 0", () => {
    expect(() => NotificationDraftSchema.parse({ ...VALID, leadTimeDays: 0 })).not.toThrow();
  });
});
