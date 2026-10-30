import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ReasonRelay } from "./reason-relay.js";
import { McpEventService } from "./events.js";

it("persists over 50 pending messages across instances, concurrent writers, reads and scoped ack", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-queue-"));
  try {
    const options = { cachePath: join(dir, "cache.json"), configPath: join(dir, "slack.json") };
    const first = new ReasonRelay(options);
    const second = new ReasonRelay(options);
    const message = (session: string, id: string) => ({ session, message_id: id, from: "sender", agent: "test", text: "body", raw: id });
    await Promise.all(Array.from({ length: 80 }, (_, i) => (i % 2 ? first : second).cacheMessages([message("cursor", String(i))])));
    await first.cacheMessages([message("muse", "0")]);
    expect(await first.readPending("cursor")).toHaveLength(80);
    expect(await second.readPending("cursor")).toHaveLength(80);
    await Promise.all([first.acknowledge("cursor", "0"), second.cacheMessages([message("cursor", "new")])]);
    expect(await second.acknowledge("cursor", "0")).toBe(false);
    const restarted = new ReasonRelay(options);
    expect(await restarted.readPending("cursor")).toHaveLength(80);
    expect((await restarted.readPending("cursor")).some((m) => m.message_id === "0")).toBe(false);
    expect(await restarted.readPending("muse")).toHaveLength(1);
    await first.cacheMessages([message("dots", "")]);
    const [generated] = await second.readPending("dots");
    expect(generated?.message_id).toBeTruthy();
    expect(await first.acknowledge("dots", generated!.message_id)).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("watches all shared queues without Slack and isolates one recipient failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-queue-"));
  try {
    const relay = new ReasonRelay({ cachePath: join(dir, "cache.json"), configPath: join(dir, "slack.json") });
    const visited: string[] = [];
    const service = new McpEventService({ storePath: join(dir, "subscriptions.json"), relay,
      listen: async (session) => {
        visited.push(session);
        if (session === "cursor") throw new Error("offline");
        return '<reason-message from="sender" id="same">body</reason-message>';
      }
    });
    await service.pollOnce();
    expect(visited).toEqual(["claude-app", "cursor", "dots", "muse"]);
    for (const session of ["claude-app", "dots", "muse"]) expect(await relay.readPending(session)).toHaveLength(1);
    expect(await service.status()).toMatchObject({ lastError: "Inbox cursor failed: offline" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("retries a consumed batch after a write failure before listening to that session again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-queue-"));
  try {
    class FailingRelay extends ReasonRelay {
      failures = 1;
      override async cacheMessages(messages: Parameters<ReasonRelay["cacheMessages"]>[0]): ReturnType<ReasonRelay["cacheMessages"]> {
        if (messages[0]?.session === "cursor" && this.failures-- > 0) throw new Error("disk unavailable");
        return super.cacheMessages(messages);
      }
    }
    const relay = new FailingRelay({ cachePath: join(dir, "cache.json"), configPath: join(dir, "slack.json") });
    let cursorListens = 0;
    const service = new McpEventService({ storePath: join(dir, "subscriptions.json"), relay,
      listen: async (session) => {
        if (session !== "cursor") return "";
        cursorListens += 1;
        return '<reason-message from="sender" id="retry">body</reason-message>';
      }
    });
    await service.pollOnce();
    expect(await relay.readPending("cursor")).toHaveLength(0);
    await service.pollOnce();
    expect(cursorListens).toBe(1);
    expect(await relay.readPending("cursor")).toHaveLength(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("suppresses pending and acknowledged replays across restart, scoped by recipient", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-replay-"));
  try {
    const options = { cachePath: join(dir, "cache.json"), configPath: join(dir, "slack.json") };
    const message = { session: "cursor", message_id: "replay", from: "sender", agent: "test", text: "body", raw: "body" };
    const first = new ReasonRelay(options);
    expect(await first.cacheMessages([message, message])).toEqual([message]);
    expect(await new ReasonRelay(options).cacheMessages([message])).toEqual([]);
    expect(await first.acknowledge("cursor", "replay")).toBe(true);
    const restarted = new ReasonRelay(options);
    expect(await restarted.cacheMessages([message])).toEqual([]);
    expect(await restarted.readPending("cursor")).toEqual([]);
    expect(await restarted.cacheMessages([{ ...message, session: "muse" }])).toHaveLength(1);
    // Missing IDs use the same stable fingerprint for ack and replay suppression.
    await first.cacheMessages([{ ...message, message_id: "" }]);
    const [pending] = await first.readPending("cursor");
    await first.acknowledge("cursor", pending!.message_id);
    expect(await restarted.cacheMessages([{ ...message, message_id: "" }])).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it("only one concurrent watcher notifies, and restart or ack cannot replay a notification", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cairn-notify-"));
  try {
    let notifications = 0;
    class NotifyingRelay extends ReasonRelay {
      override async isActive(): Promise<boolean> { return true; }
      override async notify(): Promise<void> { notifications += 1; }
    }
    const options = { cachePath: join(dir, "cache.json"), configPath: join(dir, "slack.json") };
    const makeService = () => new McpEventService({
      storePath: join(dir, "subscriptions.json"), relay: new NotifyingRelay(options),
      listen: async (session) => session === "dots" ? '<reason-message from="sender" id="once">body</reason-message>' : ""
    });
    await Promise.all([makeService().pollOnce(), makeService().pollOnce()]);
    expect(notifications).toBe(1);
    await makeService().pollOnce();
    expect(notifications).toBe(1);
    await new ReasonRelay(options).acknowledge("dots", "once");
    await makeService().pollOnce();
    expect(notifications).toBe(1);
    expect(await new ReasonRelay(options).readPending("dots")).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
