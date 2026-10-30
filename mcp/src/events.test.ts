import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { McpEventService, parseReasonMessages } from "./events.js";
import { ReasonRelay } from "./reason-relay.js";

// Keep tests that use the default relay away from the live /home/pi/cairn-data files.
const defaultRelayDir = join(tmpdir(), `cairn-events-test-${process.pid}`);
process.env.REASON_SLACK_CONFIG_PATH = join(defaultRelayDir, "reason-slack.json");
process.env.REASON_INBOX_CACHE_PATH = join(defaultRelayDir, "reason-inbox-cache.json");
delete process.env.REASON_SLACK_BOT_TOKEN;
delete process.env.REASON_SLACK_WEBHOOK_URL;

const dirs: string[] = [];
const secretBytes = Buffer.alloc(32, 7);
const secret = `whsec_${secretBytes.toString("base64")}`;
const callbackUrl = "https://events.example.test/callback";

afterEach(async () => {
  await Promise.all([...dirs.splice(0), defaultRelayDir].map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("McpEventService", () => {
  it("lists reason.message.created with webhook delivery schemas", () => {
    const service = new McpEventService();
    expect(service.list()).toMatchObject({
      events: [{
        name: "reason.message.created",
        delivery: ["webhook"],
        inputSchema: { additionalProperties: false },
        payloadSchema: { required: ["session", "from", "text"], additionalProperties: false }
      }]
    });
  });

  it("verifies, signs, persists, refreshes, and removes a deterministic subscription", async () => {
    const dir = await temporaryDirectory();
    const storePath = join(dir, "subscriptions.json");
    const requests: Array<{ body: string; headers: Headers; redirect: RequestRedirect | undefined }> = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body);
      const headers = new Headers(init?.headers);
      requests.push({ body, headers, redirect: init?.redirect });
      const challenge = (JSON.parse(body) as { challenge: string }).challenge;
      return new Response(JSON.stringify({ challenge }), { status: 200 });
    };
    const service = new McpEventService({
      storePath,
      fetchImpl,
      resolveHost: async () => ["203.0.113.10"],
      listen: async () => "",
      now: () => new Date("2026-10-25T00:00:00.000Z"),
      pollIntervalMs: 60_000
    });
    const params = subscribeParams();

    const first = await service.subscribe(params);
    service.stop();
    const second = await service.subscribe({ ...params, ttlMs: null });
    service.stop();

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ refreshBefore: "2026-10-26T00:00:00.000Z", cursor: null, truncated: false });
    expect(second.refreshBefore).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.redirect).toBe("error");
    expect(requests[0]?.headers.get("webhook-signature")).toBe(validSignature(requests[0]!));
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(storePath, "utf8")) as { subscriptions: Array<{ delivery: { secret: string } }> };
    expect(stored.subscriptions).toHaveLength(1);
    expect(stored.subscriptions[0]?.delivery.secret).toBe(secret);

    await expect(service.unsubscribe({
      name: "reason.message.created",
      arguments: {},
      delivery: { mode: "webhook", url: callbackUrl }
    })).resolves.toEqual({});
    const empty = JSON.parse(await readFile(storePath, "utf8")) as { subscriptions: unknown[] };
    expect(empty.subscriptions).toEqual([]);
  });

  it("rejects private callbacks, malformed secrets, and reserved worker sessions", async () => {
    const service = new McpEventService({ resolveHost: async () => ["127.0.0.1"] });
    await expect(service.subscribe(subscribeParams())).rejects.toMatchObject({ code: -32602 });
    await expect(service.subscribe({ ...subscribeParams(), delivery: { mode: "webhook", url: callbackUrl, secret: "whsec_bad" } }))
      .rejects.toMatchObject({ code: -32602 });
    await expect(service.subscribe({ ...subscribeParams(), arguments: { session: "pi-codex" } }))
      .rejects.toMatchObject({ code: -32602 });
  });

  it("returns CallbackEndpointError when verification does not echo the challenge", async () => {
    const service = new McpEventService({
      storePath: join(await temporaryDirectory(), "subscriptions.json"),
      resolveHost: async () => ["203.0.113.10"],
      fetchImpl: async () => new Response(JSON.stringify({ challenge: "wrong" }), { status: 200 })
    });
    await expect(service.subscribe(subscribeParams())).rejects.toMatchObject({
      code: -32015,
      message: "CallbackEndpointError",
      data: { reason: "challenge_failed" }
    });
  });

  it("polls each session and delivers a signed event to matching subscriptions", async () => {
    const dir = await temporaryDirectory();
    const deliveries: Array<{ body: string; headers: Headers }> = [];
    let verification = true;
    const service = new McpEventService({
      storePath: join(dir, "subscriptions.json"),
      resolveHost: async () => ["203.0.113.10"],
      listen: async (session) => {
        if (session !== "dots") return "";
        return `[reason-message from="zedd1324/cursor" agent="cursor" id="msg_42">hello dots[/reason-message>`;
      },
      fetchImpl: async (_url, init) => {
        const body = String(init?.body);
        if (verification) {
          verification = false;
          return new Response(JSON.stringify({ challenge: (JSON.parse(body) as { challenge: string }).challenge }), { status: 200 });
        }
        deliveries.push({ body, headers: new Headers(init?.headers) });
        return new Response(null, { status: 204 });
      },
      now: () => new Date("2026-10-25T01:02:03.000Z"),
      pollIntervalMs: 60_000
    });
    await service.subscribe(subscribeParams());
    service.stop();

    await service.pollOnce();

    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0]!;
    expect(JSON.parse(delivery.body)).toEqual({
      eventId: "evt_dots_msg_42",
      name: "reason.message.created",
      timestamp: "2026-10-25T01:02:03.000Z",
      data: {
        session: "dots",
        message_id: "msg_42",
        from: "zedd1324/cursor",
        agent: "cursor",
        text: "hello dots",
        raw: `[reason-message from="zedd1324/cursor" agent="cursor" id="msg_42">hello dots[/reason-message>`
      },
      cursor: null
    });
    expect(delivery.headers.get("webhook-id")).toBe("evt_dots_msg_42");
    expect(delivery.headers.get("webhook-signature")).toBe(validSignature(delivery));
    const status = await service.status();
    expect(status.subscriptions[0]).not.toHaveProperty("secret");
    expect(status).toMatchObject({ activeSubscriptions: 1, sessions: ["claude-app", "cursor", "dots", "muse"], lastError: null });
  });

  it("polls dots without subscriptions when the Slack relay is enabled, caching and relaying each message", async () => {
    const dir = await temporaryDirectory();
    const configPath = join(dir, "reason-slack.json");
    const cachePath = join(dir, "reason-inbox-cache.json");
    await writeFile(configPath, JSON.stringify({ enabled: true, botToken: "xoxb-test-token" }), { mode: 0o644 });
    const slackCalls: Array<{ url: string; body: string; headers: Headers }> = [];
    const relay = new ReasonRelay({
      configPath,
      cachePath,
      now: () => new Date("2026-10-25T01:02:03.000Z"),
      fetchImpl: async (url, init) => {
        slackCalls.push({ url: String(url), body: String(init?.body), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    });
    const listened: string[] = [];
    const service = new McpEventService({
      storePath: join(dir, "subscriptions.json"),
      relay,
      listen: async (session) => {
        listened.push(session);
        if (session !== "dots") return "";
        return `[reason-message from="zedd1324/cursor" agent="cursor" id="msg_7">wake <up> & go[/reason-message>`;
      },
      now: () => new Date("2026-10-25T01:02:03.000Z")
    });

    await service.pollOnce();

    expect(listened).toEqual(["claude-app", "cursor", "dots", "muse"]);
    expect(slackCalls).toHaveLength(1);
    expect(slackCalls[0]!.url).toBe("https://slack.com/api/chat.postMessage");
    expect(slackCalls[0]!.headers.get("authorization")).toBe("Bearer xoxb-test-token");
    expect(JSON.parse(slackCalls[0]!.body)).toEqual({
      channel: "C0CCT18TZEU",
      text: [
        "🔔 *[Reason Network → zedd1324/dots]*",
        "• *From:* `zedd1324/cursor` (`cursor`)",
        "• *Message ID:* `msg_7`",
        "• *Body:*",
        "wake &lt;up&gt; &amp; go"
      ].join("\n")
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect((await stat(cachePath)).mode & 0o777).toBe(0o600);
    await expect(service.status()).resolves.toMatchObject({ activeSubscriptions: 0, slackRelayActive: true, sessions: ["claude-app", "cursor", "dots", "muse"], lastError: null });
    await expect(relay.status()).resolves.toMatchObject({ mode: "token", cachedUnreadCount: 1, lastSentAt: "2026-10-25T01:02:03.000Z" });
    await expect(relay.readPending("dots")).resolves.toMatchObject([{ message_id: "msg_7", text: "wake <up> & go", unread: true }]);
    await expect(relay.readPending("dots")).resolves.toHaveLength(1);
  });

  it("keeps the message cached and records the error when Slack rejects the post", async () => {
    const dir = await temporaryDirectory();
    const relay = new ReasonRelay({
      configPath: join(dir, "reason-slack.json"),
      cachePath: join(dir, "reason-inbox-cache.json"),
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), { status: 200 })
    });
    await relay.saveConfig("xoxb-test-token");
    const service = new McpEventService({
      storePath: join(dir, "subscriptions.json"),
      relay,
      listen: async (session) => session === "dots" ? `[reason-message from="zedd1324/cursor" agent="cursor" id="msg_8">hi[/reason-message>` : ""
    });

    await service.pollOnce();

    await expect(service.status()).resolves.toMatchObject({ lastError: "Slack relay failed: Slack chat.postMessage failed: not_in_channel" });
    await expect(relay.status()).resolves.toMatchObject({ cachedUnreadCount: 1, lastSentAt: null, lastError: "Slack chat.postMessage failed: not_in_channel" });
  });
});

describe("ReasonRelay config", () => {
  it("accepts webhook URLs, tokens, and JSON, rejects other input, and never reports secrets", async () => {
    const dir = await temporaryDirectory();
    const configPath = join(dir, "reason-slack.json");
    const relay = new ReasonRelay({ configPath, cachePath: join(dir, "cache.json") });

    await expect(relay.status()).resolves.toMatchObject({ configured: false, mode: "none", channelId: "C0CCT18TZEU" });
    const webhook = await relay.saveConfig("https://hooks.slack.com/services/T000/B000/secret");
    expect(webhook).toMatchObject({ configured: true, mode: "webhook", enabled: true });
    expect(JSON.stringify(webhook)).not.toContain("secret");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);

    await relay.saveConfig(JSON.stringify({ botToken: "xoxp-user-token", channelId: "C0OTHER123" }));
    await expect(relay.status()).resolves.toMatchObject({ mode: "token", channelId: "C0OTHER123" });
    await relay.saveConfig(JSON.stringify({ enabled: false }));
    await expect(relay.status()).resolves.toMatchObject({ mode: "token", enabled: false, channelId: "C0OTHER123" });
    await expect(relay.isActive()).resolves.toBe(false);

    await expect(relay.saveConfig("https://example.com/hook")).rejects.toThrow(/hooks\.slack\.com/);
    await expect(relay.saveConfig("xoxa-nope")).rejects.toThrow(/xoxb/);
  });
});

describe("parseReasonMessages", () => {
  it("parses multiple listener blocks and skips malformed messages", () => {
    expect(parseReasonMessages([
      `[reason-message from="a" agent="one" id="1">first[/reason-message>`,
      `[reason-message agent="missing-from">ignored[/reason-message>`,
      `[reason-message from="b" id="2">second\nline[/reason-message>`
    ].join("\n"), "test-dots")).toMatchObject([
      { session: "test-dots", message_id: "1", from: "a", agent: "one", text: "first" },
      { session: "test-dots", message_id: "2", from: "b", agent: "", text: "second\nline" }
    ]);
  });

  it("also accepts the angle-bracket form emitted by some listener versions", () => {
    expect(parseReasonMessages(`<reason-message from="a" agent="one" id="1">hello</reason-message>`, "test-dots"))
      .toMatchObject([{ from: "a", agent: "one", message_id: "1", text: "hello" }]);
  });
});

function subscribeParams() {
  return {
    name: "reason.message.created",
    arguments: {},
    delivery: { mode: "webhook", url: callbackUrl, secret },
    cursor: null
  };
}

function validSignature(request: { body: string; headers: Headers }): string {
  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const digest = createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${request.body}`).digest("base64");
  return `v1,${digest}`;
}

async function temporaryDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cairn-events-"));
  dirs.push(dir);
  return dir;
}
