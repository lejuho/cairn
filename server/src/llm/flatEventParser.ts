import { FlatEventParseResultSchema, type FlatEventParseResult } from "@cairn/shared";
import type { LlmGateway } from "./gateway.js";
import { getLlmModel } from "./config.js";
import { addMinutesToRfc3339 } from "../utils/rfc3339.js";

export { addMinutesToRfc3339 };

const SYSTEM_PROMPT = `You extract exactly one calendar event from a short natural-language input.
Return ONLY a JSON object — no explanation, no markdown fences.
Schema: {"title": string, "start"?: "RFC3339-with-offset"}
Rules:
- title: concise event name, never fabricated facts.
- start: omit if date/time is genuinely unknown. Must include timezone offset matching the user's timezone.
- Do NOT return arrays, multiple events, tasks, or thread drafts.`;

function buildUserPrompt(text: string, now: string, timeZone: string): string {
  return `Current time: ${now}\nUser timezone: ${timeZone}\n\nInput: ${text}`;
}

export type ParseFlatEventResult =
  | { data: FlatEventParseResult; error: null }
  | { data: null; error: string };

export async function parseFlatEvent(
  gateway: LlmGateway,
  text: string,
  now: string,
  timeZone: string
): Promise<ParseFlatEventResult> {
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

  const validated = FlatEventParseResultSchema.safeParse(parsed);
  if (!validated.success) return { data: null, error: "invalid_schema" };
  return { data: validated.data, error: null };
}
