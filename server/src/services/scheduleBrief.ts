import type {
  AnnotationRow,
  EventRow,
  PersonRow,
  ScheduleBrief,
  ScheduleBriefPerson,
  ScheduleBriefPreparation,
  ThreadRow
} from "@cairn/shared";

// Surface only authored, factual profile fields (no inferred sensitivities, no
// advice). Malformed authored JSON was already failed-open to null upstream.
function toBriefPerson(p: PersonRow): ScheduleBriefPerson {
  const unavailableWeekdays = (p.hardConstraints ?? [])
    .filter((c) => c.type === "weekday_unavailable")
    .map((c) => c.weekday);
  return {
    personId: p.id,
    name: p.name,
    relation: p.relation ?? null,
    preferredWeekdays: p.preferredWindows?.weekdays ?? [],
    preferredPeriods: p.preferredWindows?.periods ?? [],
    leadTimeDays: p.leadTime?.days ?? null,
    unavailableWeekdays
  };
}

// Pure deterministic brief assembly. The route loads the rows (thread, nearest
// prior same-thread event, that event's newest annotation, attached people);
// this function only shapes them. No DB/LLM/external/movement access.
export function buildScheduleBrief(
  event: EventRow,
  thread: ThreadRow | null,
  previousEvent: EventRow | null,
  previousAnnotation: AnnotationRow | null,
  people: PersonRow[],
  preparations: ScheduleBriefPreparation[] = []
): ScheduleBrief {
  const briefPeople = people.map(toBriefPerson);

  const reasonCodes: string[] = [];
  if (event.mode != null) reasonCodes.push("brief_mode_present");
  if (thread != null) reasonCodes.push("brief_thread_present");
  if (previousEvent != null) reasonCodes.push("brief_previous_event");
  if (previousAnnotation != null) reasonCodes.push("brief_previous_annotation");
  if (briefPeople.length > 0) reasonCodes.push("brief_people_present");
  if (preparations.length > 0) reasonCodes.push("brief_preparations");

  return {
    mode: event.mode ?? null,
    thread: thread
      ? { id: thread.id, name: thread.name, goal: thread.goal ?? null, deadline: thread.deadline ?? null }
      : null,
    previousEvent: previousEvent
      ? { id: previousEvent.id, title: previousEvent.title, start: previousEvent.start ?? null, end: previousEvent.end ?? null }
      : null,
    previousAnnotation,
    people: briefPeople,
    preparations,
    reasonCodes
  };
}

// Pick the newest annotation (loggedAt desc, id desc) for the prior event.
// Returns null when there are none.
export function pickNewestAnnotation(annotations: AnnotationRow[]): AnnotationRow | null {
  if (annotations.length === 0) return null;
  return [...annotations].sort((a, b) => {
    const at = Date.parse(a.loggedAt);
    const bt = Date.parse(b.loggedAt);
    const diff = (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
    return diff !== 0 ? diff : b.id - a.id;
  })[0]!;
}
