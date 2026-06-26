import { ThreadDraftParsedSchema, type ThreadDraftParsed } from "@cairn/shared";
import type { LlmGateway } from "./gateway.js";
import { getLlmModel } from "./config.js";

// Single LLM boundary for thread-draft parsing (cycle-51 FR-THR-02/03). The
// model never decides firmness/source/status — those are forced by the service.
// Unknown values must be null, never placeholder strings or guessed dates.
const SYSTEM_PROMPT = `You turn a natural-language description into a STRUCTURED thread draft.
Return ONLY a JSON object — no explanation, no markdown fences.

Schema:
{
  "thread": { "name": string, "kind"?: string|null, "goal"?: string|null, "deadline"?: "YYYY-MM-DD"|null },
  "events": [ { "tempId": string, "title": string, "type"?: string|null, "start"?: "RFC3339-with-offset"|null, "end"?: "RFC3339-with-offset"|null, "location"?: string|null, "mode"?: "in_person"|"remote"|"async"|null } ],
  "tasks":  [ { "tempId": string, "title": string, "estMinutes"?: number|null, "due"?: "YYYY-MM-DD"|null, "context"?: string|null, "optional"?: boolean } ],
  "links":  [ { "from": { "kind": "event"|"task", "tempId": string }, "to": { "kind": "event"|"task", "tempId": string }, "kind": "requires"|"blocks"|"triggers"|"caused_by"|"follows" } ],
  "warnings": [ { "code": string, "message": string } ]
}

Rules:
- thread.name: concise, never fabricated.
- tempId: a unique string per node, used ONLY to wire links. Every link from/to tempId MUST match a node above.
- Unknown values: use null or omit. NEVER write placeholder strings like "?", "unknown", "TBD", or a guessed date.
- Dates: only include a date/time you are certain of. start/end MUST carry a timezone offset. If unsure, use null.
- Do NOT output firmness, source, status, score, recommendation, or any field not in the schema. Those are decided elsewhere.
- If the description has no concrete nodes, return empty events/tasks/links and add a warning explaining what input is needed.`;

function buildUserPrompt(text: string, now: string, timeZone: string): string {
  return `Current time: ${now}\nUser timezone: ${timeZone}\n\nDescription: ${text}`;
}

export type ParseThreadDraftResult =
  | { data: ThreadDraftParsed; error: null }
  | { data: null; error: string };

export async function parseThreadDraft(
  gateway: LlmGateway,
  text: string,
  now: string,
  timeZone: string
): Promise<ParseThreadDraftResult> {
  const result = await gateway.completeChat({
    model: getLlmModel(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(text, now, timeZone) }
    ],
    temperature: 0
  });

  if (!result.ok) return { data: null, error: result.error.code };

  const raw = result.data.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: null, error: "invalid_json" };
  }

  const validated = ThreadDraftParsedSchema.safeParse(parsed);
  if (!validated.success) return { data: null, error: "invalid_schema" };
  return { data: validated.data, error: null };
}
