import { describe, expect, it } from "vitest";
import type { ResourceRow } from "./resources.js";
import {
  ApprovePromotionRequestSchema,
  CreateEventPreparationRequestSchema,
  CreateEventPreparationResponseDataSchema,
  CreateResourceLinkRequestSchema,
  CreateResourceRequestSchema,
  PromotionSuggestionSchema,
  ResourceLinkRowSchema,
  ResourceRowSchema,
  ThreadResourceFocusDataSchema
} from "./resources.js";

const VALID_RESOURCE: ResourceRow = {
  id: 1,
  name: "노트북",
  kind: "item",
  sourcePersonId: null,
  note: null,
  createdAt: "2026-06-21 09:00:00"
};

describe("CreateResourceRequestSchema", () => {
  it("accepts valid item creation", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "노트북", kind: "item" }).success
    ).toBe(true);
  });

  it("trims whitespace from name", () => {
    const result = CreateResourceRequestSchema.safeParse({ name: "  노트북  ", kind: "knowledge" });
    expect(result.success && result.data.name).toBe("노트북");
  });

  it("rejects empty name", () => {
    expect(CreateResourceRequestSchema.safeParse({ name: "", kind: "item" }).success).toBe(false);
  });

  it("rejects name longer than 120 characters", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "a".repeat(121), kind: "item" }).success
    ).toBe(false);
  });

  it("rejects invalid kind", () => {
    expect(CreateResourceRequestSchema.safeParse({ name: "X", kind: "document" }).success).toBe(false);
  });

  it("rejects injected score field (strict)", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "X", kind: "item", score: 9 }).success
    ).toBe(false);
  });

  it("rejects injected recommendation field (strict)", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "X", kind: "item", recommendation: "buy now" }).success
    ).toBe(false);
  });

  it("rejects injected advice field (strict)", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "X", kind: "item", advice: "do this" }).success
    ).toBe(false);
  });

  it("rejects injected action field (strict)", () => {
    expect(
      CreateResourceRequestSchema.safeParse({ name: "X", kind: "item", action: "promote" }).success
    ).toBe(false);
  });
});

describe("CreateResourceLinkRequestSchema", () => {
  it("accepts valid event link", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({ targetType: "event", targetId: 5, firmness: "hard" }).success
    ).toBe(true);
  });

  it("accepts valid task link with default firmness", () => {
    const result = CreateResourceLinkRequestSchema.safeParse({ targetType: "task", targetId: 3 });
    expect(result.success && result.data.firmness).toBe("soft");
  });

  it("accepts thread target type", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({ targetType: "thread", targetId: 2 }).success
    ).toBe(true);
  });

  it("rejects invalid target type", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({ targetType: "person", targetId: 1 }).success
    ).toBe(false);
  });

  it("rejects invalid firmness", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({ targetType: "event", targetId: 1, firmness: "maybe" }).success
    ).toBe(false);
  });

  it("rejects reason longer than 300 characters", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({
        targetType: "event",
        targetId: 1,
        reason: "a".repeat(301)
      }).success
    ).toBe(false);
  });

  it("rejects injected certainty field (strict)", () => {
    expect(
      CreateResourceLinkRequestSchema.safeParse({ targetType: "event", targetId: 1, certainty: 0.9 }).success
    ).toBe(false);
  });
});

describe("ResourceRowSchema", () => {
  it("accepts a valid resource row", () => {
    expect(ResourceRowSchema.safeParse(VALID_RESOURCE).success).toBe(true);
  });

  it("rejects injected score field (strict)", () => {
    expect(ResourceRowSchema.safeParse({ ...VALID_RESOURCE, score: 5 }).success).toBe(false);
  });
});

describe("ResourceLinkRowSchema", () => {
  const VALID_LINK = {
    id: 1,
    resourceId: 1,
    targetType: "event" as const,
    targetId: 10,
    firmness: "soft" as const,
    reason: null,
    createdAt: "2026-06-21 09:00:00"
  };

  it("accepts a valid link row", () => {
    expect(ResourceLinkRowSchema.safeParse(VALID_LINK).success).toBe(true);
  });

  it("rejects injected recommendation field (strict)", () => {
    expect(ResourceLinkRowSchema.safeParse({ ...VALID_LINK, recommendation: "link this" }).success).toBe(false);
  });
});

describe("ThreadResourceFocusDataSchema", () => {
  it("accepts valid focus data with no resources", () => {
    expect(
      ThreadResourceFocusDataSchema.safeParse({ threadId: 1, resources: [] }).success
    ).toBe(true);
  });

  it("accepts focus data with a resource and link", () => {
    const data = {
      threadId: 1,
      resources: [
        {
          resource: VALID_RESOURCE,
          sourcePerson: null,
          links: [
            { targetType: "event", targetId: 5, firmness: "soft", reason: null }
          ]
        }
      ]
    };
    expect(ThreadResourceFocusDataSchema.safeParse(data).success).toBe(true);
  });

  it("accepts focus data with sourcePerson populated", () => {
    const data = {
      threadId: 1,
      resources: [
        {
          resource: { ...VALID_RESOURCE, sourcePersonId: 3 },
          sourcePerson: { id: 3, name: "Alice" },
          links: []
        }
      ]
    };
    expect(ThreadResourceFocusDataSchema.safeParse(data).success).toBe(true);
  });
});

describe("PromotionSuggestionSchema", () => {
  const VALID: object = {
    candidateKey: "노트북::item::event:1,task:2",
    name: "노트북",
    kind: "item",
    occurrenceCount: 2,
    occurrences: [
      { targetType: "event", targetId: 1 },
      { targetType: "task", targetId: 2 }
    ]
  };

  it("accepts valid suggestion", () => {
    expect(PromotionSuggestionSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts with optional existingResourceId", () => {
    expect(PromotionSuggestionSchema.safeParse({ ...VALID, existingResourceId: 5 }).success).toBe(true);
  });

  it("rejects injected score field (strict)", () => {
    expect(PromotionSuggestionSchema.safeParse({ ...VALID, score: 9 }).success).toBe(false);
  });

  it("rejects injected recommendation field (strict)", () => {
    expect(PromotionSuggestionSchema.safeParse({ ...VALID, recommendation: "yes" }).success).toBe(false);
  });
});

describe("ApprovePromotionRequestSchema", () => {
  const VALID_APPROVE: object = {
    candidateKey: "노트북::item::event:1,task:2",
    name: "노트북",
    kind: "item",
    occurrences: [
      { targetType: "event", targetId: 1 },
      { targetType: "task", targetId: 2 }
    ]
  };

  it("accepts valid approve request", () => {
    expect(ApprovePromotionRequestSchema.safeParse(VALID_APPROVE).success).toBe(true);
  });

  it("rejects fewer than two occurrences", () => {
    expect(ApprovePromotionRequestSchema.safeParse({
      ...VALID_APPROVE,
      occurrences: [{ targetType: "event", targetId: 1 }]
    }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, name: "" }).success).toBe(false);
  });

  it("rejects empty candidateKey", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, candidateKey: "" }).success).toBe(false);
  });

  it("rejects invalid kind", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, kind: "tool" }).success).toBe(false);
  });

  it("accepts optional threadId for scoped approval", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, threadId: 3 }).success).toBe(true);
  });

  it("rejects non-integer threadId", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, threadId: 1.5 }).success).toBe(false);
  });

  it("rejects injected stale fields (strict)", () => {
    expect(ApprovePromotionRequestSchema.safeParse({ ...VALID_APPROVE, score: 9 }).success).toBe(false);
  });

  it("rejects invalid occurrence targetType", () => {
    expect(ApprovePromotionRequestSchema.safeParse({
      ...VALID_APPROVE,
      occurrences: [
        { targetType: "person", targetId: 1 },
        { targetType: "event", targetId: 2 }
      ]
    }).success).toBe(false);
  });
});

describe("CreateEventPreparationRequestSchema", () => {
  it("accepts a valid item name", () => {
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "노트북" }).success).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const r = CreateEventPreparationRequestSchema.safeParse({ name: "  노트북  " });
    expect(r.success && r.data.name).toBe("노트북");
  });

  it("rejects blank-after-trim", () => {
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects overlong name (>120 after trim)", () => {
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("rejects missing name", () => {
    expect(CreateEventPreparationRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects injected kind/sourcePerson/note/firmness/aiSuggestion (strict)", () => {
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x", kind: "knowledge" }).success).toBe(false);
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x", sourcePersonId: 1 }).success).toBe(false);
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x", note: "y" }).success).toBe(false);
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x", firmness: "hard" }).success).toBe(false);
    expect(CreateEventPreparationRequestSchema.safeParse({ name: "x", aiSuggestion: "z" }).success).toBe(false);
  });
});

describe("CreateEventPreparationResponseDataSchema", () => {
  const VALID = {
    resource: { id: 7, name: "노트북", kind: "item", sourcePersonId: null, note: null, createdAt: null },
    link: { id: 3, resourceId: 7, targetType: "event", targetId: 1, firmness: "hard", reason: "직접 추가", createdAt: null },
    reusedResource: false,
    reusedLink: false
  };
  it("accepts a full response", () => {
    expect(CreateEventPreparationResponseDataSchema.safeParse(VALID).success).toBe(true);
  });
  it("requires reusedResource/reusedLink", () => {
    const { reusedLink, ...without } = VALID;
    void reusedLink;
    expect(CreateEventPreparationResponseDataSchema.safeParse(without).success).toBe(false);
  });
  it("rejects injected fields (strict)", () => {
    expect(CreateEventPreparationResponseDataSchema.safeParse({ ...VALID, suggestion: "x" }).success).toBe(false);
  });
});
