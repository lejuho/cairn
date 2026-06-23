import { describe, expect, it } from "vitest";
import type { PromotionOccurrence } from "@cairn/shared";
import { buildCandidateKey, buildPromotionSuggestions, checkPromotionStaleness } from "./resource-promotions.js";
import type { CandidateSourceNode, ExistingLinkEntry } from "./resource-promotions.js";

// Helper: build minimal CandidateSourceNode
function node(type: "event" | "task" | "thread", id: number, ...fields: string[]): CandidateSourceNode {
  return { targetType: type, targetId: id, fields };
}

describe("buildPromotionSuggestions — extraction", () => {
  it("recognizes item: prefix as item kind", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.kind).toBe("item");
    expect(suggestions[0]!.name).toBe("노트북");
  });

  it("recognizes 준비물: prefix as item kind", () => {
    const nodes = [
      node("event", 1, "준비물: 충전기"),
      node("task", 2, "준비물: 충전기")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.kind).toBe("item");
    expect(suggestions[0]!.name).toBe("충전기");
  });

  it("recognizes knowledge: prefix as knowledge kind", () => {
    const nodes = [
      node("thread", 1, "knowledge: React hooks"),
      node("event", 2, "knowledge: React hooks")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.kind).toBe("knowledge");
  });

  it("recognizes 지식: prefix as knowledge kind", () => {
    const nodes = [
      node("event", 1, "지식: 알고리즘"),
      node("task", 2, "지식: 알고리즘")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.kind).toBe("knowledge");
  });

  it("trims and collapses whitespace in name", () => {
    const nodes = [
      node("event", 1, "item:  맥북  프로  "),
      node("task", 2, "item:  맥북  프로  ")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(1);
    // Multi-space collapsed to single space
    expect(suggestions[0]!.name).toBe("맥북 프로");
  });

  it("stops name capture at comma", () => {
    const nodes = [
      node("event", 1, "item: 노트북, 충전기"),
      node("task", 2, "item: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.name).toBe("노트북");
  });

  it("stops name capture at newline", () => {
    const nodes = [
      node("event", 1, "item: 태블릿\n다음 항목"),
      node("task", 2, "item: 태블릿")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.name).toBe("태블릿");
  });

  it("ignores empty name after trim", () => {
    const nodes = [
      node("event", 1, "item: "),
      node("task", 2, "item: ")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(0);
  });

  it("ignores name exceeding 120 characters", () => {
    const longName = "a".repeat(121);
    const nodes = [
      node("event", 1, `item: ${longName}`),
      node("task", 2, `item: ${longName}`)
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(0);
  });
});

describe("buildPromotionSuggestions — eligibility", () => {
  it("one-off mention is ignored", () => {
    const nodes = [node("event", 1, "item: 노트북")];
    expect(buildPromotionSuggestions(nodes, [])).toHaveLength(0);
  });

  it("same name across two distinct nodes becomes one suggestion", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.occurrenceCount).toBe(2);
  });

  it("same name+kind across three nodes gives occurrenceCount=3", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북"),
      node("thread", 3, "item: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions[0]!.occurrenceCount).toBe(3);
  });

  it("same name with different kind remains separate suggestions", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북"),
      node("event", 3, "knowledge: 노트북"),
      node("task", 4, "knowledge: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(2);
    const kinds = suggestions.map((s) => s.kind).sort();
    expect(kinds).toEqual(["item", "knowledge"]);
  });

  it("same node appearing twice for same name counts as one occurrence", () => {
    // Comma stops first capture; second 'item:' in same field gives same name again
    const nodes = [
      node("event", 1, "item: 노트북, item: 노트북"),
      node("task", 2, "item: 노트북")
    ];
    const suggestions = buildPromotionSuggestions(nodes, []);
    expect(suggestions).toHaveLength(1);
    // event:1 and task:2 — event only counted once despite two mentions
    expect(suggestions[0]!.occurrenceCount).toBe(2);
  });
});

describe("buildPromotionSuggestions — suppression", () => {
  it("suppresses suggestion when all occurrences already linked", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북")
    ];
    const existing: ExistingLinkEntry[] = [
      { resourceName: "노트북", resourceKind: "item", targetType: "event", targetId: 1 },
      { resourceName: "노트북", resourceKind: "item", targetType: "task", targetId: 2 }
    ];
    expect(buildPromotionSuggestions(nodes, existing)).toHaveLength(0);
  });

  it("keeps suggestion when only partial links exist", () => {
    const nodes = [
      node("event", 1, "item: 노트북"),
      node("task", 2, "item: 노트북")
    ];
    const existing: ExistingLinkEntry[] = [
      { resourceName: "노트북", resourceKind: "item", targetType: "event", targetId: 1 }
    ];
    expect(buildPromotionSuggestions(nodes, existing)).toHaveLength(1);
  });
});

describe("buildCandidateKey", () => {
  it("produces deterministic key regardless of occurrence order", () => {
    const occA: PromotionOccurrence[] = [
      { targetType: "event", targetId: 1 },
      { targetType: "task", targetId: 2 }
    ];
    const occB: PromotionOccurrence[] = [
      { targetType: "task", targetId: 2 },
      { targetType: "event", targetId: 1 }
    ];
    expect(buildCandidateKey("노트북", "item", occA)).toBe(buildCandidateKey("노트북", "item", occB));
  });
});

describe("checkPromotionStaleness", () => {
  const occurrences: PromotionOccurrence[] = [
    { targetType: "event", targetId: 1 },
    { targetType: "task", targetId: 2 }
  ];
  const key = buildCandidateKey("노트북", "item", occurrences);

  it("returns null when approved matches recomputed", () => {
    const recomputed = [{
      candidateKey: key,
      name: "노트북",
      kind: "item" as const,
      occurrenceCount: 2,
      occurrences
    }];
    expect(checkPromotionStaleness({ candidateKey: key, name: "노트북", kind: "item", occurrences }, recomputed)).toBeNull();
  });

  it("returns PROMOTION_NOT_ELIGIBLE when suggestion not in recomputed", () => {
    expect(checkPromotionStaleness({ candidateKey: key, name: "충전기", kind: "item", occurrences }, [])).toBe("PROMOTION_NOT_ELIGIBLE");
  });

  it("returns PROMOTION_STALE when candidate key differs", () => {
    const differentOcc: PromotionOccurrence[] = [
      { targetType: "event", targetId: 1 },
      { targetType: "task", targetId: 99 }
    ];
    const differentKey = buildCandidateKey("노트북", "item", differentOcc);
    const recomputed = [{
      candidateKey: differentKey,
      name: "노트북",
      kind: "item" as const,
      occurrenceCount: 2,
      occurrences: differentOcc
    }];
    expect(checkPromotionStaleness({ candidateKey: key, name: "노트북", kind: "item", occurrences }, recomputed)).toBe("PROMOTION_STALE");
  });
});
