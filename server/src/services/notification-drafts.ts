import type { NotificationDraft, NotificationLeadTimeStatus, NotificationReasonCode, PersonRow } from "@cairn/shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type LeadTimeResult = {
  status: NotificationLeadTimeStatus;
  codes: NotificationReasonCode[];
};

function classifyLeadTime(
  leadTimeDays: number | null | undefined,
  eventStartIso: string | null | undefined,
  nowMs: number
): LeadTimeResult {
  const codes: NotificationReasonCode[] = [];

  if (leadTimeDays == null) codes.push("lead_time_unset");

  const startMs = eventStartIso ? Date.parse(eventStartIso) : NaN;
  if (!Number.isFinite(startMs)) codes.push("event_time_unknown");

  // Any unknown dimension → unknown status; collect all applicable codes.
  if (codes.length > 0) return { status: "unknown", codes };

  const gap = startMs - nowMs;
  const required = leadTimeDays! * MS_PER_DAY;
  if (gap >= required) return { status: "enough", codes };
  codes.push("lead_time_late");
  return { status: "late", codes };
}

function buildMessage(name: string, title: string, outcome: "moved" | "cancelled"): string {
  if (outcome === "moved") {
    return `${name}님, "${title}" 일정 변경이 필요해. 새 시간은 정해지는 대로 알려줄게.`;
  }
  return `${name}님, "${title}" 일정을 취소해야 해. 미안해.`;
}

export function buildNotificationDrafts(
  affectedPeople: PersonRow[],
  eventTitle: string,
  outcome: "moved" | "cancelled",
  changedEventStart: string | null | undefined,
  nowMs: number
): NotificationDraft[] {
  // Dedup by id (first-seen), then sort name asc, id asc for determinism.
  const seen = new Map<number, PersonRow>();
  for (const person of affectedPeople) {
    if (!seen.has(person.id)) seen.set(person.id, person);
  }
  const sorted = [...seen.values()].sort((a, b) => {
    const nc = a.name.localeCompare(b.name);
    return nc !== 0 ? nc : a.id - b.id;
  });

  return sorted.map((person) => {
    const reasonCodes: NotificationReasonCode[] = [];

    const channel = (person.channel === "none" || person.channel == null)
      ? null
      : person.channel;
    if (!channel) reasonCodes.push("channel_unset");

    const lt = classifyLeadTime(person.leadTime?.days ?? null, changedEventStart, nowMs);
    reasonCodes.push(...lt.codes);

    reasonCodes.push("tone_profile_unavailable");

    return {
      personId: person.id,
      personName: person.name,
      channel,
      leadTimeDays: person.leadTime?.days ?? null,
      leadTimeStatus: lt.status,
      tone: "neutral" as const,
      message: buildMessage(person.name, eventTitle, outcome),
      reasonCodes
    };
  });
}
