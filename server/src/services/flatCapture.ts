import type { CaptureStatus, FlatCaptureResponseData } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { addMinutesToRfc3339, parseFlatEvent } from "../llm/flatEventParser.js";
import { createEvent, insertRawEvent } from "../repositories/events.js";

const DEFAULT_TIMEZONE = process.env.CAIRN_TIME_ZONE ?? "Asia/Seoul";
const FALLBACK_NOW = () => new Date().toISOString().replace("Z", "+00:00");

export async function captureFlat(
  db: CairnDatabase,
  gateway: LlmGateway,
  input: { text: string; now?: string; timeZone?: string }
): Promise<FlatCaptureResponseData> {
  const trimmed = input.text.trim();
  const now = input.now ?? FALLBACK_NOW();
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;

  let parsed = null;
  let llmErrorMsg: string | undefined;

  try {
    parsed = await parseFlatEvent(gateway, trimmed, now, timeZone);
  } catch (e) {
    llmErrorMsg = e instanceof Error ? e.message : "parser error";
  }

  if (parsed === null) {
    const event = insertRawEvent(db, trimmed);
    return { event, captureStatus: "raw_stored" as CaptureStatus, llmError: llmErrorMsg };
  }

  if (!parsed.start) {
    const event = insertRawEvent(db, parsed.title);
    return { event, captureStatus: "unscheduled" as CaptureStatus };
  }

  const start = parsed.start;
  const end = addMinutesToRfc3339(start, 60);
  const event = createEvent(db, { title: parsed.title, start, end });
  return { event, captureStatus: "scheduled" as CaptureStatus };
}
