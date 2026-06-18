import type { AnnotationIntakeSuccessData, EventRow } from "@cairn/shared";
import type { CairnDatabase } from "../db/index.js";
import type { LlmGateway } from "../llm/gateway.js";
import { findEventById } from "../repositories/events.js";
import { clearParam, readParam, upsertParam } from "../repositories/params.js";
import { intakeAnnotation } from "../services/annotationIntake.js";
import { listNeedsReviewEvents } from "../services/needsReview.js";
import { createTelegramClient, type TelegramClient, type TelegramUpdate } from "./client.js";

const OFFSET_KEY = "telegram.offset";
const DEFAULT_POLL_TIMEOUT_SECONDS = 20;
const DEFAULT_ERROR_BACKOFF_MS = 1_000;
const DEFAULT_ERROR_BACKOFF_MAX_MS = 60_000;
const DEFAULT_ERROR_LOG_THROTTLE_MS = 60_000;

export type TelegramWorker = {
  pollOnce: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
};

export function createTelegramWorker(input: {
  db: CairnDatabase;
  gateway: LlmGateway;
  client: TelegramClient;
  chatId: string;
  now?: () => Date;
  pollTimeoutSeconds?: number;
  errorBackoffMs?: number;
  errorBackoffMaxMs?: number;
  errorLogThrottleMs?: number;
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
  logError?: (error: unknown) => void;
}): TelegramWorker {
  const now = input.now ?? (() => new Date());
  const nowMs = input.nowMs ?? (() => Date.now());
  const sleepMs = input.sleepMs ?? sleep;
  const pollTimeoutSeconds = input.pollTimeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS;
  const errorBackoffMs = input.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;
  const errorBackoffMaxMs = input.errorBackoffMaxMs ?? DEFAULT_ERROR_BACKOFF_MAX_MS;
  const errorLogThrottleMs = input.errorLogThrottleMs ?? DEFAULT_ERROR_LOG_THROTTLE_MS;
  const logError = input.logError ?? ((error) => console.error("[telegram]", error));
  let stopped = false;
  let currentErrorBackoffMs = errorBackoffMs;
  let lastErrorLogAtMs: number | null = null;

  return {
    async pollOnce() {
      const offset = readOffset(input.db);
      const updates = await input.client.getUpdates(
        offset === undefined
          ? { timeoutSeconds: pollTimeoutSeconds }
          : { offset, timeoutSeconds: pollTimeoutSeconds }
      );

      let nextOffset = offset;
      for (const update of updates) {
        nextOffset = Math.max(nextOffset ?? 0, update.updateId + 1);
        await processUpdate(input.db, input.gateway, input.client, input.chatId, update);
      }

      if (nextOffset !== undefined) {
        upsertParam(input.db, OFFSET_KEY, String(nextOffset));
      }

      await maybeSendReviewPrompt(input.db, input.client, input.chatId, now().toISOString());
    },

    async start() {
      stopped = false;
      while (!stopped) {
        try {
          await this.pollOnce();
          currentErrorBackoffMs = errorBackoffMs;
          lastErrorLogAtMs = null;
        } catch (error) {
          const currentTimeMs = nowMs();
          if (
            lastErrorLogAtMs === null ||
            errorLogThrottleMs <= 0 ||
            currentTimeMs - lastErrorLogAtMs >= errorLogThrottleMs
          ) {
            logError(error);
            lastErrorLogAtMs = currentTimeMs;
          }
          if (!stopped) {
            await sleepMs(currentErrorBackoffMs);
            currentErrorBackoffMs = Math.min(
              errorBackoffMaxMs,
              Math.max(errorBackoffMs, currentErrorBackoffMs * 2)
            );
          }
        }
      }
    },

    stop() {
      stopped = true;
    }
  };
}

export function createTelegramWorkerFromEnv(input: {
  db: CairnDatabase;
  gateway: LlmGateway;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logError?: (error: unknown) => void;
}): TelegramWorker | null {
  if (process.env.TELEGRAM_POLL_ENABLED !== "1") {
    return null;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    input.logError?.(new Error("Telegram polling enabled without TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID"));
    return null;
  }

  return createTelegramWorker({
    db: input.db,
    gateway: input.gateway,
    client: input.fetchImpl
      ? createTelegramClient({ botToken, fetchImpl: input.fetchImpl })
      : createTelegramClient({ botToken, forceIpv4: process.env.TELEGRAM_FORCE_IPV4 === "1" }),
    chatId,
    pollTimeoutSeconds: readPositiveIntegerEnv("TELEGRAM_POLL_TIMEOUT_SECONDS", DEFAULT_POLL_TIMEOUT_SECONDS),
    errorBackoffMs: readPositiveIntegerEnv("TELEGRAM_ERROR_BACKOFF_MS", DEFAULT_ERROR_BACKOFF_MS),
    errorBackoffMaxMs: readPositiveIntegerEnv("TELEGRAM_ERROR_BACKOFF_MAX_MS", DEFAULT_ERROR_BACKOFF_MAX_MS),
    errorLogThrottleMs: readNonNegativeIntegerEnv("TELEGRAM_ERROR_LOG_THROTTLE_MS", DEFAULT_ERROR_LOG_THROTTLE_MS),
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.logError === undefined ? {} : { logError: input.logError })
  });
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function maybeSendReviewPrompt(
  db: CairnDatabase,
  client: TelegramClient,
  chatId: string,
  nowIso: string
): Promise<void> {
  const candidates = listNeedsReviewEvents(db, nowIso, Number.MAX_SAFE_INTEGER);
  const nextEvent = candidates.find((event) => readParam(db, promptedKey(event.id)) === null);
  if (!nextEvent) {
    return;
  }

  const sent = await client.sendMessage({
    chatId,
    text: formatPrompt(nextEvent)
  });

  upsertParam(db, promptedKey(nextEvent.id), String(sent.messageId));
  upsertParam(db, promptMessageKey(sent.messageId), String(nextEvent.id));
}

async function processUpdate(
  db: CairnDatabase,
  gateway: LlmGateway,
  client: TelegramClient,
  chatId: string,
  update: TelegramUpdate
): Promise<void> {
  const message = update.message;
  if (!message) return;
  if (message.chatId !== chatId) return;
  if (message.replyToMessageId === null) return;
  if (message.text === null || message.text.trim() === "") return;

  const eventIdValue = readParam(db, promptMessageKey(message.replyToMessageId));
  if (eventIdValue === null) return;

  const eventId = Number.parseInt(eventIdValue, 10);
  if (!Number.isFinite(eventId) || eventId <= 0) {
    clearParam(db, promptMessageKey(message.replyToMessageId));
    return;
  }

  const event = findEventById(db, eventId);
  if (!event) {
    clearParam(db, promptMessageKey(message.replyToMessageId));
    return;
  }

  const result = await intakeAnnotation(db, gateway, eventId, message.text);
  clearParam(db, promptMessageKey(message.replyToMessageId));

  await client.sendMessage({
    chatId,
    text: formatAck(result),
    replyToMessageId: message.messageId
  });
}

function readOffset(db: CairnDatabase): number | undefined {
  const value = readParam(db, OFFSET_KEY);
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function promptedKey(eventId: number): string {
  return `telegram.reviewPrompted.${eventId}`;
}

function promptMessageKey(messageId: number): string {
  return `telegram.promptMessage.${messageId}`;
}

function formatPrompt(event: EventRow): string {
  return `${event.title}\n${formatTimeWindow(event)}\n어떻게 됐어? 한 줄로 답해줘.`;
}

function formatAck(result: AnnotationIntakeSuccessData): string {
  if (result.parseStatus === "parsed") {
    return "기록했어.";
  }
  return "원문 저장했어. 구조화는 지금 안 됐어.";
}

function formatTimeWindow(event: EventRow): string {
  const start = event.start?.slice(11, 16) ?? "??:??";
  const end = event.end?.slice(11, 16) ?? "??:??";
  return `${start} - ${end}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
