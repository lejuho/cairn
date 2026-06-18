import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmGateway } from "../llm/gateway.js";
import { buildServer } from "../app.js";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { createTelegramWorker, createTelegramWorkerFromEnv } from "./worker.js";
import type { TelegramClient, TelegramUpdate } from "./client.js";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-telegram-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
  vi.restoreAllMocks();
  delete process.env.TELEGRAM_POLL_ENABLED;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_POLL_TIMEOUT_SECONDS;
  delete process.env.TELEGRAM_ERROR_BACKOFF_MS;
  delete process.env.TELEGRAM_ERROR_BACKOFF_MAX_MS;
  delete process.env.TELEGRAM_ERROR_LOG_THROTTLE_MS;
});

function insertEndedEvent(
  conn: SqliteConnection,
  overrides: { title?: string; start?: string; end?: string; status?: string } = {}
): number {
  const start = overrides.start ?? "2026-06-16T09:00:00+00:00";
  const end = overrides.end ?? "2026-06-16T10:00:00+00:00";
  const status = overrides.status ?? "planned";
  const title = overrides.title ?? "Past Event";

  const result = conn.sqlite
    .prepare(
      "INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, ?)"
    )
    .run(title, start, end, status);
  return Number(result.lastInsertRowid);
}

function readParamValue(conn: SqliteConnection, key: string): string | null {
  const row = conn.sqlite
    .prepare("SELECT value FROM params WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

function parsedGateway(content: string): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    async completeChat() {
      return {
        ok: true,
        data: {
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 1,
          model: "grok-beta",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop"
            }
          ]
        }
      };
    }
  };
}

function unavailableGateway(): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    async completeChat() {
      return {
        ok: false,
        error: { code: "unavailable", message: "Proxy is down" }
      };
    }
  };
}

class MockTelegramClient implements TelegramClient {
  private nextMessageId = 900;

  readonly getUpdatesCalls: Array<{ offset?: number; timeoutSeconds: number }> = [];
  readonly sentMessages: Array<{ chatId: string; text: string; replyToMessageId?: number }> = [];

  constructor(private updates: TelegramUpdate[] = []) {}

  async getUpdates(input: { offset?: number; timeoutSeconds: number }): Promise<TelegramUpdate[]> {
    this.getUpdatesCalls.push(input);
    const result = this.updates;
    this.updates = [];
    return result;
  }

  async sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }> {
    this.sentMessages.push(input);
    this.nextMessageId += 1;
    return { messageId: this.nextMessageId };
  }
}

class FailingTelegramClient implements TelegramClient {
  getUpdatesCalls = 0;

  async getUpdates(): Promise<TelegramUpdate[]> {
    this.getUpdatesCalls += 1;
    throw new TypeError("fetch failed");
  }

  async sendMessage(): Promise<{ messageId: number }> {
    throw new Error("sendMessage should not be called");
  }
}

describe("Telegram worker: outbound prompt", () => {
  it("sends one prompt for an eligible needs-review event and stores params", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn, { title: "Team sync" });
    const client = new MockTelegramClient([
      { updateId: 41, message: null }
    ]);
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-16T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]!.chatId).toBe("1234");
    expect(client.sentMessages[0]!.text).toContain("Team sync");
    expect(readParamValue(conn, "telegram.offset")).toBe("42");
    expect(readParamValue(conn, `telegram.reviewPrompted.${eventId}`)).toBe("901");
    expect(readParamValue(conn, "telegram.promptMessage.901")).toBe(String(eventId));
    conn.sqlite.close();
  });

  it("annotated event is never prompted", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn);
    conn.sqlite.prepare("INSERT INTO annotations (event_id, reason_text) VALUES (?, ?)").run(eventId, "done");
    const client = new MockTelegramClient();
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-16T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    expect(client.sentMessages).toHaveLength(0);
    conn.sqlite.close();
  });

  it("already-prompted event is not sent again", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn);
    conn.sqlite
      .prepare("INSERT INTO params (key, value) VALUES (?, ?)")
      .run(`telegram.reviewPrompted.${eventId}`, "901");
    const client = new MockTelegramClient();
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-16T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    expect(client.sentMessages).toHaveLength(0);
    conn.sqlite.close();
  });
});

describe("Telegram worker: inbound replies", () => {
  it("reply-to known prompt creates annotation and sends parsed ack", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn, { title: "Dentist" });
    conn.sqlite
      .prepare("INSERT INTO params (key, value) VALUES (?, ?)")
      .run("telegram.promptMessage.777", String(eventId));
    const client = new MockTelegramClient([
      {
        updateId: 50,
        message: {
          messageId: 888,
          chatId: "1234",
          text: "끝났어",
          replyToMessageId: 777
        }
      }
    ]);
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"outcome\":\"done\",\"reasonTags\":[\"ok\"],\"reasonText\":\"끝났어\"}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-16T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    const row = conn.sqlite
      .prepare("SELECT reason_text, outcome FROM annotations WHERE event_id = ?")
      .get(eventId) as { reason_text: string; outcome: string };
    expect(row.reason_text).toBe("끝났어");
    expect(row.outcome).toBe("done");
    expect(readParamValue(conn, "telegram.promptMessage.777")).toBeNull();
    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]!.replyToMessageId).toBe(888);
    expect(client.sentMessages[0]!.text).toBe("기록했어.");
    conn.sqlite.close();
  });

  it("raw_stored fallback sends raw-saved ack and keeps deterministic routes healthy", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn, { title: "Dinner" });
    conn.sqlite
      .prepare("INSERT INTO params (key, value) VALUES (?, ?)")
      .run("telegram.promptMessage.777", String(eventId));
    const client = new MockTelegramClient([
      {
        updateId: 51,
        message: {
          messageId: 889,
          chatId: "1234",
          text: "옮김",
          replyToMessageId: 777
        }
      }
    ]);
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: unavailableGateway(),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-16T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    const row = conn.sqlite
      .prepare("SELECT reason_text, outcome FROM annotations WHERE event_id = ?")
      .get(eventId) as { reason_text: string; outcome: string | null };
    expect(row.reason_text).toBe("옮김");
    expect(row.outcome).toBeNull();
    expect(client.sentMessages).toHaveLength(1);
    expect(client.sentMessages[0]!.text).toContain("원문 저장했어");

    const app = buildServer(conn.db);
    const res = await app.inject({
      method: "GET",
      url: "/api/today?date=2026-06-16&now=2026-06-16T12%3A00%3A00%2B00%3A00"
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.needsReviewEvents).toHaveLength(0);
    conn.sqlite.close();
  });

  it("wrong chat is ignored", async () => {
    const conn = makeTestDb();
    insertEndedEvent(conn);
    conn.sqlite
      .prepare("INSERT INTO params (key, value) VALUES (?, ?)")
      .run("telegram.promptMessage.777", "1");
    const client = new MockTelegramClient([
      {
        updateId: 52,
        message: {
          messageId: 890,
          chatId: "9999",
          text: "끝났어",
          replyToMessageId: 777
        }
      }
    ]);
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"outcome\":\"done\",\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-18T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    const count = conn.sqlite.prepare("SELECT COUNT(*) AS n FROM annotations").get() as { n: number };
    expect(count.n).toBe(0);
    expect(client.sentMessages).toHaveLength(0);
    conn.sqlite.close();
  });

  it("non-reply inbound text is ignored", async () => {
    const conn = makeTestDb();
    const client = new MockTelegramClient([
      {
        updateId: 53,
        message: {
          messageId: 891,
          chatId: "1234",
          text: "그냥 말",
          replyToMessageId: null
        }
      }
    ]);
    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      now: () => new Date("2026-06-18T12:00:00+00:00"),
      pollTimeoutSeconds: 0
    });

    await worker.pollOnce();

    const count = conn.sqlite.prepare("SELECT COUNT(*) AS n FROM annotations").get() as { n: number };
    expect(count.n).toBe(0);
    expect(client.sentMessages).toHaveLength(0);
    conn.sqlite.close();
  });
});

describe("Telegram worker: env absent", () => {
  it("does not start a worker and app still serves health and today", async () => {
    const conn = makeTestDb();
    const eventId = insertEndedEvent(conn);
    const worker = createTelegramWorkerFromEnv({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      logError: vi.fn()
    });

    expect(worker).toBeNull();

    const app = buildServer(conn.db);
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const today = await app.inject({
      method: "GET",
      url: "/api/today?date=2026-06-16&now=2026-06-16T12%3A00%3A00%2B00%3A00"
    });
    expect(today.statusCode).toBe(200);
    expect(today.json().data.needsReviewEvents[0].id).toBe(eventId);
    conn.sqlite.close();
  });
});

describe("Telegram worker: operations resilience", () => {
  it("backs off exponentially and throttles repeated poll errors", async () => {
    const conn = makeTestDb();
    const client = new FailingTelegramClient();
    const logError = vi.fn();
    const sleeps: number[] = [];
    let clockMs = 0;
    const holder: { worker?: ReturnType<typeof createTelegramWorker> } = {};

    const worker = createTelegramWorker({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      client,
      chatId: "1234",
      pollTimeoutSeconds: 0,
      errorBackoffMs: 10,
      errorBackoffMaxMs: 40,
      errorLogThrottleMs: 25,
      nowMs: () => clockMs,
      sleepMs: async (ms) => {
        sleeps.push(ms);
        clockMs += ms;
        if (sleeps.length >= 4) holder.worker?.stop();
      },
      logError
    });
    holder.worker = worker;

    await worker.start();

    expect(client.getUpdatesCalls).toBe(4);
    expect(sleeps).toEqual([10, 20, 40, 40]);
    expect(logError).toHaveBeenCalledTimes(3);
    conn.sqlite.close();
  });

  it("reads TELEGRAM_POLL_TIMEOUT_SECONDS from env", async () => {
    const conn = makeTestDb();
    process.env.TELEGRAM_POLL_ENABLED = "1";
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "1234";
    process.env.TELEGRAM_POLL_TIMEOUT_SECONDS = "7";

    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const worker = createTelegramWorkerFromEnv({
      db: conn.db,
      gateway: parsedGateway("{\"reasonTags\":[]}"),
      fetchImpl
    });

    expect(worker).not.toBeNull();
    await worker!.pollOnce();

    expect(urls[0]!).toContain("timeout=7");
    conn.sqlite.close();
  });
});
