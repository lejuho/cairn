import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteConnection, runMigrations, type SqliteConnection } from "../db/index.js";
import { buildServer } from "../app.js";
import type { LlmGateway, LlmGatewayResult } from "../llm/gateway.js";
import type { ChatCompletionRequest } from "@cairn/shared";

const tempDirs: string[] = [];

function makeTestDb(): SqliteConnection {
  const dir = mkdtempSync(join(tmpdir(), "cairn-ann-"));
  tempDirs.push(dir);
  const conn = createSqliteConnection(join(dir, "test.sqlite3"));
  runMigrations(conn);
  return conn;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function makeGateway(
  handler: (req: ChatCompletionRequest) => LlmGatewayResult | Promise<LlmGatewayResult>
): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    async completeChat(req) {
      return handler(req);
    }
  };
}

function parsedGateway(parsed: object): LlmGateway {
  return makeGateway(() => ({
    ok: true,
    data: {
      id: "test-1",
      object: "chat.completion" as const,
      created: 0,
      model: "grok-beta",
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: JSON.stringify(parsed) },
          finish_reason: "stop"
        }
      ]
    }
  }));
}

function unavailableGateway(): LlmGateway {
  return makeGateway(() => ({
    ok: false,
    error: { code: "unavailable", message: "Proxy is down" }
  }));
}

function insertTestEvent(conn: SqliteConnection): number {
  const result = conn.sqlite
    .prepare(
      "INSERT INTO events (title, start, end, source, self_imposed, status) VALUES (?, ?, ?, 'cairn', 1, 'planned')"
    )
    .run("Test Event", "2026-06-16T10:00:00+09:00", "2026-06-16T11:00:00+09:00");
  return Number(result.lastInsertRowid);
}

// ── Validation ────────────────────────────────────────────────────────────────

describe("POST /api/events/:id/annotations — validation", () => {
  it("rejects non-positive event id (0)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: "/api/events/0/annotations", payload: { text: "done" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("rejects non-positive event id (negative)", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: "/api/events/-1/annotations", payload: { text: "done" } });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("rejects non-integer event id", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: "/api/events/abc/annotations", payload: { text: "done" } });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("rejects empty text", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/annotations`, payload: { text: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    conn.sqlite.close();
  });

  it("rejects whitespace-only text", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: `/api/events/${eventId}/annotations`, payload: { text: "   " } });
    expect(res.statusCode).toBe(400);
    conn.sqlite.close();
  });

  it("returns 404 for missing event", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db, unavailableGateway());
    const res = await app.inject({ method: "POST", url: "/api/events/9999/annotations", payload: { text: "done" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    conn.sqlite.close();
  });
});

// ── Raw fallback ──────────────────────────────────────────────────────────────

describe("POST /api/events/:id/annotations — raw fallback", () => {
  it("stores raw annotation when proxy is unavailable", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const app = buildServer(conn.db, unavailableGateway());

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "It ran late, had to cancel" }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parseStatus).toBe("raw_stored");
    expect(body.data.llmError).toBeTruthy();
    expect(body.data.annotation.reasonText).toBe("It ran late, had to cancel");
    expect(body.data.annotation.outcome).toBeNull();

    const row = conn.sqlite.prepare("SELECT * FROM annotations WHERE event_id = ?").get(eventId) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row["reason_text"]).toBe("It ran late, had to cancel");
    expect(row["outcome"]).toBeNull();
    conn.sqlite.close();
  });

  it("stores raw annotation when LLM returns invalid JSON", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = makeGateway(() => ({
      ok: true,
      data: {
        id: "t1",
        object: "chat.completion" as const,
        created: 0,
        model: "grok-beta",
        choices: [{ index: 0, message: { role: "assistant" as const, content: "not json at all" }, finish_reason: "stop" }]
      }
    }));
    const app = buildServer(conn.db, gateway);

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "moved to next week" }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.parseStatus).toBe("raw_stored");
    conn.sqlite.close();
  });

  it("stores raw annotation when LLM returns invalid schema", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = parsedGateway({ outcome: "unknown_value", energyAtTime: 99 });
    const app = buildServer(conn.db, gateway);

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "some text" }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.parseStatus).toBe("raw_stored");
    conn.sqlite.close();
  });

  it("raw annotation exists in DB before LLM parse attempt", async () => {
    // Proxy failure proves raw row was committed before LLM call.
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const app = buildServer(conn.db, unavailableGateway());

    await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "cancelled last minute" }
    });

    const count = (conn.sqlite.prepare("SELECT COUNT(*) AS n FROM annotations WHERE event_id = ?").get(eventId) as { n: number }).n;
    expect(count).toBe(1);
    conn.sqlite.close();
  });
});

// ── Successful parse ──────────────────────────────────────────────────────────

describe("POST /api/events/:id/annotations — successful parse", () => {
  it("fills outcome, reason_tags, energy_at_time, reason_text", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = parsedGateway({
      outcome: "done",
      reasonTags: ["focused", "completed"],
      energyAtTime: 4,
      reasonText: "Finished on time"
    });
    const app = buildServer(conn.db, gateway);

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "done, felt good" }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parseStatus).toBe("parsed");
    expect(body.data.annotation.outcome).toBe("done");
    expect(body.data.annotation.energyAtTime).toBe(4);
    expect(body.data.annotation.reasonText).toBe("Finished on time");

    const row = conn.sqlite.prepare("SELECT * FROM annotations WHERE event_id = ?").get(eventId) as Record<string, unknown>;
    expect(row["outcome"]).toBe("done");
    expect(row["reason_tags"]).toBe('["focused","completed"]');
    expect(row["energy_at_time"]).toBe(4);
    conn.sqlite.close();
  });

  it("updates events.status when outcome is present", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = parsedGateway({ outcome: "cancelled" });
    const app = buildServer(conn.db, gateway);

    await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "had to cancel" }
    });

    const event = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(eventId) as { status: string };
    expect(event.status).toBe("cancelled");
    conn.sqlite.close();
  });

  it("does not update events.status when no outcome in parse result", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = parsedGateway({ reasonTags: ["interesting"], energyAtTime: 3 });
    const app = buildServer(conn.db, gateway);

    await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "was interesting" }
    });

    const event = conn.sqlite.prepare("SELECT status FROM events WHERE id = ?").get(eventId) as { status: string };
    expect(event.status).toBe("planned");
    conn.sqlite.close();
  });

  it("defaults reason_text to raw input when LLM omits reasonText", async () => {
    const conn = makeTestDb();
    const eventId = insertTestEvent(conn);
    const gateway = parsedGateway({ outcome: "done" });
    const app = buildServer(conn.db, gateway);

    const res = await app.inject({
      method: "POST",
      url: `/api/events/${eventId}/annotations`,
      payload: { text: "it is done" }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.annotation.reasonText).toBe("it is done");
    conn.sqlite.close();
  });
});

// ── Deterministic routes remain available ────────────────────────────────────

describe("Deterministic routes work without gateway", () => {
  it("/health returns ok without gateway", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    conn.sqlite.close();
  });

  it("/api/today works without gateway", async () => {
    const conn = makeTestDb();
    const app = buildServer(conn.db);

    const res = await app.inject({
      method: "GET",
      url: "/api/today?date=2026-06-16&now=2026-06-16T00%3A00%3A00%2B00%3A00"
    });
    expect(res.statusCode).toBe(200);
    conn.sqlite.close();
  });
});
