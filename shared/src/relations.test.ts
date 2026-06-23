import { describe, expect, it } from "vitest";
import {
  EgoGraphDataSchema,
  EgoGraphEdgeSchema,
  EgoGraphNodeSchema,
  EgoGraphQuerySchema
} from "./relations.js";

describe("EgoGraphQuerySchema", () => {
  it("accepts resource center", () => {
    const r = EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "3" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.targetId).toBe(3);
      expect(r.data.limit).toBe(10);
    }
  });

  it("accepts person center", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "person", targetId: "5" }).success).toBe(true);
  });

  it("accepts explicit limit in [5,10]", () => {
    const r = EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "1", limit: "7" });
    expect(r.success && r.data.limit).toBe(7);
  });

  it("rejects limit below 5", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "1", limit: "4" }).success).toBe(false);
  });

  it("rejects limit above 10", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "1", limit: "11" }).success).toBe(false);
  });

  it("rejects invalid targetType", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "task", targetId: "1" }).success).toBe(false);
  });

  it("rejects non-integer targetId", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "abc" }).success).toBe(false);
  });

  it("rejects zero targetId", () => {
    expect(EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "0" }).success).toBe(false);
  });

  it("rejects injected layout coordinate (strict)", () => {
    expect(
      EgoGraphQuerySchema.safeParse({ targetType: "resource", targetId: "1", x: 0, y: 0 }).success
    ).toBe(false);
  });
});

describe("EgoGraphNodeSchema", () => {
  const VALID_NODE = {
    id: "resource:3",
    type: "resource" as const,
    targetId: 3,
    label: "노트북"
  };

  it("accepts valid node", () => {
    expect(EgoGraphNodeSchema.safeParse(VALID_NODE).success).toBe(true);
  });

  it("accepts node with optional sublabel and href", () => {
    expect(EgoGraphNodeSchema.safeParse({ ...VALID_NODE, sublabel: "발표 준비", href: "/threads/1" }).success).toBe(true);
  });

  it("rejects injected score (strict)", () => {
    expect(EgoGraphNodeSchema.safeParse({ ...VALID_NODE, score: 9 }).success).toBe(false);
  });

  it("rejects injected x/y layout coordinates (strict)", () => {
    expect(EgoGraphNodeSchema.safeParse({ ...VALID_NODE, x: 100, y: 200 }).success).toBe(false);
  });

  it("rejects injected recommendation (strict)", () => {
    expect(EgoGraphNodeSchema.safeParse({ ...VALID_NODE, recommendation: "link this" }).success).toBe(false);
  });
});

describe("EgoGraphEdgeSchema", () => {
  const VALID_EDGE = {
    from: "resource:3",
    to: "event:9",
    kind: "resource_link" as const,
    firmness: "soft" as const
  };

  it("accepts valid resource_link edge", () => {
    expect(EgoGraphEdgeSchema.safeParse(VALID_EDGE).success).toBe(true);
  });

  it("accepts edge with reason", () => {
    expect(EgoGraphEdgeSchema.safeParse({ ...VALID_EDGE, reason: "발표 준비" }).success).toBe(true);
  });

  it("accepts thread_link edge with relationKind", () => {
    expect(EgoGraphEdgeSchema.safeParse({
      ...VALID_EDGE,
      kind: "thread_link",
      relationKind: "contains"
    }).success).toBe(true);
  });

  it("rejects invalid edge kind", () => {
    expect(EgoGraphEdgeSchema.safeParse({ ...VALID_EDGE, kind: "inferred" }).success).toBe(false);
  });

  it("rejects invalid firmness", () => {
    expect(EgoGraphEdgeSchema.safeParse({ ...VALID_EDGE, firmness: "maybe" }).success).toBe(false);
  });

  it("rejects injected score (strict)", () => {
    expect(EgoGraphEdgeSchema.safeParse({ ...VALID_EDGE, score: 9 }).success).toBe(false);
  });

  it("rejects injected layout coordinates (strict)", () => {
    expect(EgoGraphEdgeSchema.safeParse({ ...VALID_EDGE, dx: 10, dy: 20 }).success).toBe(false);
  });
});

describe("EgoGraphDataSchema", () => {
  const CENTER: object = {
    id: "resource:3",
    type: "resource",
    targetId: 3,
    label: "노트북"
  };

  it("accepts valid graph data", () => {
    expect(EgoGraphDataSchema.safeParse({
      center: CENTER,
      nodes: [CENTER],
      edges: [],
      truncated: false
    }).success).toBe(true);
  });

  it("rejects injected score at top level (strict)", () => {
    expect(EgoGraphDataSchema.safeParse({
      center: CENTER,
      nodes: [CENTER],
      edges: [],
      truncated: false,
      score: 9
    }).success).toBe(false);
  });
});
