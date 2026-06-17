import { FlatEventParseResultSchema, type FlatEventParseResult } from "@cairn/shared";
import type { LlmGateway } from "./gateway.js";

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

// Add minutes to an RFC3339 string, preserving the original offset suffix.
export function addMinutesToRfc3339(rfc3339: string, minutes: number): string {
  const offsetMatch = rfc3339.match(/([+-]\d{2}:\d{2})$/);
  if (!offsetMatch) return rfc3339;
  const offsetStr = offsetMatch[1]!;
  const sign = offsetStr[0] === "+" ? 1 : -1;
  const parts = offsetStr.slice(1).split(":");
  const offsetMs = sign * (Number(parts[0]) * 60 + Number(parts[1])) * 60_000;

  const newEpochMs = Date.parse(rfc3339) + minutes * 60_000;
  const localMs = newEpochMs + offsetMs;
  const d = new Date(localMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    offsetStr
  );
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
    model: "grok-3-mini",
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
