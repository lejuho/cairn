import { describe, expect, it } from "vitest";
import type { ResourceRow } from "@cairn/shared";
import { buildPreparations } from "./preparationBrief.js";
import type { PreparationLinkData, PreparationLinkEntry } from "../repositories/resources.js";

function res(id: number, name: string, kind: "item" | "knowledge", sourcePersonId: number | null = null): ResourceRow {
  return { id, name, kind, sourcePersonId, note: null, createdAt: null };
}

function link(
  scope: PreparationLinkEntry["scope"],
  resourceId: number,
  targetType: "event" | "thread",
  targetId: number,
  firmness: PreparationLinkEntry["firmness"] = "soft",
  reason: string | null = null
): PreparationLinkEntry {
  return { scope, resourceId, targetType, targetId, firmness, reason };
}

function data(over: Partial<PreparationLinkData> = {}): PreparationLinkData {
  return { links: [], resources: [], sourcePersons: [], ...over };
}

describe("buildPreparations — empty / grouping", () => {
  it("no links → empty", () => {
    expect(buildPreparations(data())).toEqual([]);
  });

  it("groups multiple relevant links under one resource", () => {
    const out = buildPreparations(data({
      links: [
        link("event_direct", 7, "event", 1, "hard", "발표용"),
        link("thread_context", 7, "thread", 1, "soft", null)
      ],
      resources: [res(7, "노트북", "item")]
    }));
    expect(out).toHaveLength(1);
    expect(out[0]!.resource.id).toBe(7);
    expect(out[0]!.links).toHaveLength(2);
    expect(out[0]!.reasonCodes).toEqual(["prep_event_direct", "prep_thread_context"]);
  });

  it("dedupes identical (resource, scope, target) link rows", () => {
    const out = buildPreparations(data({
      links: [link("event_direct", 7, "event", 1), link("event_direct", 7, "event", 1)],
      resources: [res(7, "노트북", "item")]
    }));
    expect(out[0]!.links).toHaveLength(1);
  });

  it("ignores links whose resource was not loaded", () => {
    const out = buildPreparations(data({
      links: [link("event_direct", 99, "event", 1)],
      resources: [] // resource 99 missing
    }));
    expect(out).toEqual([]);
  });
});

describe("buildPreparations — sorting", () => {
  it("sorts item before knowledge, then name asc, then id asc", () => {
    const out = buildPreparations(data({
      links: [
        link("event_direct", 1, "event", 1),
        link("event_direct", 2, "event", 1),
        link("event_direct", 3, "event", 1),
        link("event_direct", 4, "event", 1)
      ],
      resources: [
        res(1, "지식 B", "knowledge"),
        res(2, "물건 B", "item"),
        res(3, "물건 A", "item"),
        res(4, "물건 A", "item") // same name as 3, lower id wins
      ]
    }));
    expect(out.map((p) => p.resource.id)).toEqual([3, 4, 2, 1]);
  });

  it("sorts links by scope order then targetId", () => {
    const out = buildPreparations(data({
      links: [
        link("previous_event", 7, "event", 9),
        link("event_direct", 7, "event", 1),
        link("thread_context", 7, "thread", 5)
      ],
      resources: [res(7, "노트북", "item")]
    }));
    expect(out[0]!.links.map((l) => l.scope)).toEqual(["event_direct", "thread_context", "previous_event"]);
  });

  it("per-link firmness is preserved (not promoted across scopes)", () => {
    const out = buildPreparations(data({
      links: [
        link("event_direct", 7, "event", 1, "hard"),
        link("previous_event", 7, "event", 9, "tentative")
      ],
      resources: [res(7, "노트북", "item")]
    }));
    const byScope = Object.fromEntries(out[0]!.links.map((l) => [l.scope, l.firmness]));
    expect(byScope.event_direct).toBe("hard");
    expect(byScope.previous_event).toBe("tentative");
  });
});

describe("buildPreparations — source person", () => {
  it("attaches source person when known", () => {
    const out = buildPreparations(data({
      links: [link("event_direct", 7, "event", 1)],
      resources: [res(7, "노트북", "item", 5)],
      sourcePersons: [{ id: 5, name: "Alice" }]
    }));
    expect(out[0]!.sourcePerson).toEqual({ id: 5, name: "Alice" });
  });

  it("source person null when resource has no sourcePersonId", () => {
    const out = buildPreparations(data({
      links: [link("event_direct", 7, "event", 1)],
      resources: [res(7, "노트북", "item", null)]
    }));
    expect(out[0]!.sourcePerson).toBeNull();
  });

  it("source person null when sourcePersonId set but person missing/deleted", () => {
    const out = buildPreparations(data({
      links: [link("event_direct", 7, "event", 1)],
      resources: [res(7, "노트북", "item", 5)],
      sourcePersons: [] // person 5 not present
    }));
    expect(out[0]!.sourcePerson).toBeNull();
  });
});
