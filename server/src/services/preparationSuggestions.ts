import type {
  EventRow,
  ScheduleBriefPreparation,
  ScheduleBriefPreparationSuggestion,
  ThreadRow
} from "@cairn/shared";

// Presentation/demo/lecture keyword family (A-slice). Latin keywords are
// matched case-insensitively; Hangul keywords are matched as written.
const PRESENTATION_KEYWORDS = [
  "발표",
  "프레젠테이션",
  "presentation",
  "demo",
  "데모",
  "강의",
  "세미나"
] as const;

// Fixed item suggestions for the presentation trigger, in deterministic order.
const PRESENTATION_ITEMS = ["노트북", "충전기", "어댑터"] as const;

const REASON = "발표 일정이라 보통 챙기는 준비물";

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesPresentation(haystack: string | null | undefined): boolean {
  if (!haystack) return false;
  const norm = normalize(haystack);
  return PRESENTATION_KEYWORDS.some((kw) => norm.includes(kw.toLowerCase()));
}

// Pure deterministic preparation suggestions (cycle-47 FR-BRF-04). No DB/LLM/
// external. Suggests a fixed item set when a presentation keyword appears in the
// event title, thread name, or thread goal; suppresses items already visible in
// `preparations`. Evidence is the first matching field in fixed order.
export function buildPreparationSuggestions(
  event: EventRow,
  thread: ThreadRow | null,
  preparations: ScheduleBriefPreparation[]
): ScheduleBriefPreparationSuggestion[] {
  // Evidence candidates in fixed priority order.
  const candidates: { field: "event_title" | "thread_name" | "thread_goal"; value: string | null }[] = [
    { field: "event_title", value: event.title },
    { field: "thread_name", value: thread?.name ?? null },
    { field: "thread_goal", value: thread?.goal ?? null }
  ];

  const matched = candidates.find((c) => matchesPresentation(c.value));
  if (!matched || matched.value == null) return [];

  const alreadyPresent = new Set(preparations.map((p) => p.resource.name.trim()));

  const suggestions: ScheduleBriefPreparationSuggestion[] = [];
  for (const name of PRESENTATION_ITEMS) {
    if (alreadyPresent.has(name)) continue;
    suggestions.push({
      key: `presentation:${name}`,
      name,
      kind: "item",
      source: "deterministic_keyword",
      reasonCode: "presentation_keyword",
      reason: REASON,
      evidence: { field: matched.field, value: matched.value }
    });
  }
  return suggestions;
}
