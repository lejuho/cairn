import type { PromotionOccurrence, PromotionSuggestion, ResourceKind, ResourceTargetType } from "@cairn/shared";

export type CandidateSourceNode = {
  targetType: ResourceTargetType;
  targetId: number;
  fields: string[];
};

type Mention = {
  name: string;
  kind: ResourceKind;
};

// Extract explicit resource mentions from a single text field.
// Patterns (case-insensitive):
//   item: <name>  |  준비물: <name>   -> kind="item"
//   knowledge: <name>  |  지식: <name> -> kind="knowledge"
// Name capture stops at comma, semicolon, newline, or sentence end ([.?!]).
const ITEM_RE = /(?:item|준비물)\s*:\s*([^,;\n.?!]+)/gi;
const KNOWLEDGE_RE = /(?:knowledge|지식)\s*:\s*([^,;\n.?!]+)/gi;

function extractMentions(text: string): Mention[] {
  const result: Mention[] = [];
  for (const match of text.matchAll(ITEM_RE)) {
    const raw = (match[1] ?? "").trim().replace(/\s+/g, " ");
    if (raw.length > 0 && raw.length <= 120) {
      result.push({ name: raw, kind: "item" });
    }
  }
  for (const match of text.matchAll(KNOWLEDGE_RE)) {
    const raw = (match[1] ?? "").trim().replace(/\s+/g, " ");
    if (raw.length > 0 && raw.length <= 120) {
      result.push({ name: raw, kind: "knowledge" });
    }
  }
  return result;
}

// Build a deterministic candidate key that encodes name, kind, and occurrence set.
// Format: "name::kind::targetType:targetId,..."  (occurrences sorted)
export function buildCandidateKey(
  name: string,
  kind: ResourceKind,
  occurrences: PromotionOccurrence[]
): string {
  const sorted = [...occurrences]
    .sort((a, b) => {
      const ta = `${a.targetType}:${a.targetId}`;
      const tb = `${b.targetType}:${b.targetId}`;
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    })
    .map((o) => `${o.targetType}:${o.targetId}`)
    .join(",");
  return `${name}::${kind}::${sorted}`;
}

export type ExistingLinkEntry = {
  resourceName: string;
  resourceKind: ResourceKind;
  targetType: ResourceTargetType;
  targetId: number;
};

// Build promotion suggestions from candidate source nodes.
// existingLinks: all resource_links (name/kind keyed) for suppression.
export function buildPromotionSuggestions(
  nodes: CandidateSourceNode[],
  existingLinks: ExistingLinkEntry[]
): PromotionSuggestion[] {
  // Collect all mentions keyed by (normalizedName, kind) -> Set of occurrence keys.
  type OccKey = string; // "targetType:targetId"
  const grouped = new Map<string, { name: string; kind: ResourceKind; occurrences: Map<OccKey, PromotionOccurrence> }>();

  for (const node of nodes) {
    for (const field of node.fields) {
      if (!field) continue;
      const mentions = extractMentions(field);
      for (const { name, kind } of mentions) {
        const groupKey = `${name}::${kind}`;
        let group = grouped.get(groupKey);
        if (!group) {
          group = { name, kind, occurrences: new Map() };
          grouped.set(groupKey, group);
        }
        const occKey = `${node.targetType}:${node.targetId}`;
        if (!group.occurrences.has(occKey)) {
          group.occurrences.set(occKey, { targetType: node.targetType, targetId: node.targetId });
        }
      }
    }
  }

  // Build existing-link lookup: "name::kind::targetType:targetId" -> true
  const linkedSet = new Set<string>();
  for (const l of existingLinks) {
    linkedSet.add(`${l.resourceName}::${l.resourceKind}::${l.targetType}:${l.targetId}`);
  }

  const suggestions: PromotionSuggestion[] = [];

  for (const [, group] of grouped) {
    if (group.occurrences.size < 2) continue;

    const occurrences = [...group.occurrences.values()];

    // Suppress if every occurrence is already linked to same name+kind resource.
    const allLinked = occurrences.every((o) =>
      linkedSet.has(`${group.name}::${group.kind}::${o.targetType}:${o.targetId}`)
    );
    if (allLinked) continue;

    const candidateKey = buildCandidateKey(group.name, group.kind, occurrences);
    suggestions.push({
      candidateKey,
      name: group.name,
      kind: group.kind,
      occurrenceCount: occurrences.length,
      occurrences
    });
  }

  return suggestions;
}

// Verify that a POST approve body matches the recomputed suggestion.
// Returns null if valid, or an error code string.
export function checkPromotionStaleness(
  approved: { candidateKey: string; name: string; kind: ResourceKind; occurrences: PromotionOccurrence[] },
  recomputed: PromotionSuggestion[]
): "PROMOTION_STALE" | "PROMOTION_NOT_ELIGIBLE" | null {
  const match = recomputed.find(
    (s) => s.name === approved.name && s.kind === approved.kind
  );
  if (!match) return "PROMOTION_NOT_ELIGIBLE";
  if (match.occurrences.length < 2) return "PROMOTION_NOT_ELIGIBLE";
  if (match.candidateKey !== approved.candidateKey) return "PROMOTION_STALE";

  // Verify occurrence sets match (same sorted key).
  const approvedKey = buildCandidateKey(approved.name, approved.kind, approved.occurrences);
  if (approvedKey !== match.candidateKey) return "PROMOTION_STALE";

  return null;
}
