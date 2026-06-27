import { describe, expect, it } from "vitest";
import { EventStatusSchema, EVENT_STATUSES, ThreadDomainSchema, THREAD_DOMAINS } from "./enums.js";

describe("stored enum contracts", () => {
  it("accepts lowercase persisted event statuses", () => {
    expect(EventStatusSchema.parse("planned")).toBe("planned");
    expect(EVENT_STATUSES).toContain("cancelled");
  });

  it("rejects uppercase database values", () => {
    expect(() => EventStatusSchema.parse("PLANNED")).toThrow();
  });

  it("ThreadDomainSchema accepts lowercase personal/work and rejects uppercase/unknown (cycle-67)", () => {
    expect(ThreadDomainSchema.parse("personal")).toBe("personal");
    expect(ThreadDomainSchema.parse("work")).toBe("work");
    expect(THREAD_DOMAINS).toEqual(["personal", "work"]);
    expect(() => ThreadDomainSchema.parse("Personal")).toThrow();
    expect(() => ThreadDomainSchema.parse("WORK")).toThrow();
    expect(() => ThreadDomainSchema.parse("school")).toThrow();
  });
});
