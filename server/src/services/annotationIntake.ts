import type { AnnotationIntakeSuccessData } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { insertRawAnnotation, updateAnnotationStructured } from "../repositories/annotations.js";
import { updateEventStatus } from "../repositories/events.js";
import { parseAnnotationWithLlm } from "../llm/annotationParser.js";

export async function intakeAnnotation(
  db: CairnDatabase,
  gateway: LlmGateway,
  eventId: number,
  rawText: string
): Promise<AnnotationIntakeSuccessData> {
  // 1. Raw insert first — always persisted before any LLM call.
  let annotation = insertRawAnnotation(db, eventId, rawText);

  // 2. Best-effort LLM parse.
  const parseResult = await parseAnnotationWithLlm(gateway, rawText);

  if (!parseResult.ok) {
    return { annotation, parseStatus: "raw_stored", llmError: parseResult.error };
  }

  const parsed = parseResult.data;

  // 3. Update structured fields.
  annotation = updateAnnotationStructured(db, annotation.id, {
    outcome: parsed.outcome ?? null,
    reasonTags: JSON.stringify(parsed.reasonTags),
    reasonText: parsed.reasonText ?? rawText,
    energyAtTime: parsed.energyAtTime ?? null
  });

  // 4. If outcome present, propagate to event status.
  if (parsed.outcome !== undefined) {
    updateEventStatus(db, eventId, parsed.outcome);
  }

  return { annotation, parseStatus: "parsed" };
}
