import { ParsedAnnotationSchema, type ParsedAnnotation } from "@cairn/shared";
import type { LlmGateway } from "./gateway.js";
import { getLlmModel } from "./config.js";

export type ParseAnnotationResult =
  | { ok: true; data: ParsedAnnotation }
  | { ok: false; error: string };

const SYSTEM_PROMPT = `Extract annotation fields from the user's reply about an event. Return ONLY valid JSON, no prose.
Schema: { "outcome": "done"|"cancelled"|"moved"|"late" (optional), "reasonTags": string[] (default []), "energyAtTime": 1-5 integer (optional), "reasonText": string (optional) }`;

export async function parseAnnotationWithLlm(
  gateway: LlmGateway,
  rawText: string
): Promise<ParseAnnotationResult> {
  const result = await gateway.completeChat({
    model: getLlmModel(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: rawText }
    ],
    max_tokens: 256
  });

  if (!result.ok) {
    return { ok: false, error: result.error.message };
  }

  const content = result.data.choices[0]?.message.content ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: "LLM returned invalid JSON" };
  }

  const validated = ParsedAnnotationSchema.safeParse(parsed);
  if (!validated.success) {
    return { ok: false, error: `LLM response failed schema validation: ${validated.error.message}` };
  }

  return { ok: true, data: validated.data };
}
