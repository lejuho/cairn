import type { CaptureStatus, FlatCaptureResponseData } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import type { ParseFlatEventResult } from "../llm/flatEventParser.js";
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

  let parseResult: ParseFlatEventResult;
  try {
    parseResult = await parseFlatEvent(gateway, trimmed, now, timeZone);
  } catch (e) {
    const err = e instanceof Error ? e.message : "parser error";
    const event = insertRawEvent(db, trimmed);
    return { event, captureStatus: "raw_stored" as CaptureStatus, llmError: err };
  }

  if (parseResult.data === null) {
    const event = insertRawEvent(db, trimmed);
    return { event, captureStatus: "raw_stored" as CaptureStatus, llmError: parseResult.error };
  }

  const { data: parsed } = parseResult;

  if (!parsed.start) {
    const event = insertRawEvent(db, parsed.title);
    return { event, captureStatus: "unscheduled" as CaptureStatus };
  }

  const start = parsed.start;
  const end = addMinutesToRfc3339(start, 60);
  const event = createEvent(db, { title: parsed.title, start, end });
  return { event, captureStatus: "scheduled" as CaptureStatus };
}
