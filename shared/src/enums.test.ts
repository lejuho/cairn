import { describe, expect, it } from "vitest";
import { EventStatusSchema, EVENT_STATUSES } from "./enums.js";

describe("stored enum contracts", () => {
  it("accepts lowercase persisted event statuses", () => {
    expect(EventStatusSchema.parse("planned")).toBe("planned");
    expect(EVENT_STATUSES).toContain("cancelled");
  });

  it("rejects uppercase database values", () => {
    expect(() => EventStatusSchema.parse("PLANNED")).toThrow();
  });
});
