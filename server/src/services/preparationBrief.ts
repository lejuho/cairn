import type {
  ResourceFirmness,
  ResourceRow,
  ScheduleBriefPreparation,
  ScheduleBriefPreparationLink
} from "@cairn/shared";
import type { PreparationLinkData, PreparationScope } from "../repositories/resources.js";

// Deterministic scope ordering for link sort (plan: event_direct, thread_context,
// previous_event).
const SCOPE_ORDER: Record<PreparationScope, number> = {
  event_direct: 0,
  thread_context: 1,
  previous_event: 2
};
const FIRMNESS_ORDER: Record<ResourceFirmness, number> = { hard: 0, soft: 1, tentative: 2 };
// item before knowledge (plan).
const KIND_ORDER: Record<string, number> = { item: 0, knowledge: 1 };

function linkKey(l: { resourceId: number; scope: PreparationScope; targetId: number }): string {
  return `${l.resourceId}:${l.scope}:${l.targetId}`;
}

// Pure deterministic preparation builder. Groups the flat tagged links by
// resource id, attaches the source person, sorts resources and links
// deterministically, and emits per-preparation reasonCodes. No DB/LLM/external.
export function buildPreparations(input: PreparationLinkData): ScheduleBriefPreparation[] {
  const { links, resources, sourcePersons } = input;
  if (links.length === 0) return [];

  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const personById = new Map(sourcePersons.map((p) => [p.id, p]));

  // Dedupe identical (resource, scope, target) link rows before grouping.
  const seen = new Set<string>();
  const linksByResource = new Map<number, ScheduleBriefPreparationLink[]>();
  for (const l of links) {
    if (!resourceById.has(l.resourceId)) continue; // ignore links whose resource was not loaded
    const key = linkKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = linksByResource.get(l.resourceId) ?? [];
    bucket.push({
      targetType: l.targetType,
      targetId: l.targetId,
      scope: l.scope,
      firmness: l.firmness,
      reason: l.reason ?? null
    });
    linksByResource.set(l.resourceId, bucket);
  }

  const preparations: ScheduleBriefPreparation[] = [];
  for (const [resourceId, resourceLinks] of linksByResource) {
    const resource = resourceById.get(resourceId)!;
    const sortedLinks = [...resourceLinks].sort((a, b) => {
      const scopeDiff = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
      if (scopeDiff !== 0) return scopeDiff;
      if (a.targetId !== b.targetId) return a.targetId - b.targetId;
      return FIRMNESS_ORDER[a.firmness] - FIRMNESS_ORDER[b.firmness];
    });

    // One reasonCode per distinct scope present, in scope order.
    const scopesPresent = [...new Set(sortedLinks.map((l) => l.scope))].sort(
      (a, b) => SCOPE_ORDER[a] - SCOPE_ORDER[b]
    );
    const reasonCodes = scopesPresent.map((s) => `prep_${s}`);

    preparations.push({
      resource,
      sourcePerson: resource.sourcePersonId != null ? (personById.get(resource.sourcePersonId) ?? null) : null,
      links: sortedLinks,
      reasonCodes
    });
  }

  // Sort preparations: item before knowledge, name asc, id asc.
  preparations.sort((a, b) => {
    const kindDiff = (KIND_ORDER[a.resource.kind] ?? 9) - (KIND_ORDER[b.resource.kind] ?? 9);
    if (kindDiff !== 0) return kindDiff;
    const nameDiff = compareName(a.resource, b.resource);
    if (nameDiff !== 0) return nameDiff;
    return a.resource.id - b.resource.id;
  });

  return preparations;
}

function compareName(a: ResourceRow, b: ResourceRow): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
