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
  if (leadTimeDays == null) {
    return { status: "unknown", codes: ["lead_time_unset"] };
  }
  if (!eventStartIso) {
    return { status: "unknown", codes: ["event_time_unknown"] };
  }
  const startMs = Date.parse(eventStartIso);
  if (!Number.isFinite(startMs)) {
    return { status: "unknown", codes: ["event_time_unknown"] };
  }
  const gap = startMs - nowMs;
  const required = leadTimeDays * MS_PER_DAY;
  if (gap >= required) {
    return { status: "enough", codes: [] };
  }
  return { status: "late", codes: ["lead_time_late"] };
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
  const seen = new Set<number>();
  const drafts: NotificationDraft[] = [];

  for (const person of affectedPeople) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);

    const reasonCodes: NotificationReasonCode[] = [];

    // Channel honesty
    const channel = (person.channel === "none" || person.channel == null)
      ? null
      : person.channel;
    if (!channel) reasonCodes.push("channel_unset");

    // Lead-time classification
    const lt = classifyLeadTime(person.leadTime?.days ?? null, changedEventStart, nowMs);
    reasonCodes.push(...lt.codes);

    // Tone always neutral; no authored tone vocabulary yet
    reasonCodes.push("tone_profile_unavailable");

    drafts.push({
      personId: person.id,
      personName: person.name,
      channel,
      leadTimeDays: person.leadTime?.days ?? null,
      leadTimeStatus: lt.status,
      tone: "neutral",
      message: buildMessage(person.name, eventTitle, outcome),
      reasonCodes
    });
  }

  return drafts;
}
