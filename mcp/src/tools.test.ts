import type * as ChildProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>();
  return { ...original, execFile: execFileMock, spawn: (...args: Parameters<typeof original.spawn>) =>
    args[0] === "flock" ? original.spawn(...args) : spawnMock(...args) };
});

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CairnApiClientConfig } from "./api.js";
import { defaultEventService } from "./events.js";
import { callTool } from "./tools.js";

let relayDir = "";

beforeEach(async () => {
  // The default relay resolves its paths per call, so each test gets fresh config/cache files.
  relayDir = await mkdtemp(join(tmpdir(), "cairn-tools-relay-"));
  process.env.REASON_SLACK_CONFIG_PATH = join(relayDir, "reason-slack.json");
  process.env.REASON_INBOX_CACHE_PATH = join(relayDir, "reason-inbox-cache.json");
  delete process.env.REASON_SLACK_BOT_TOKEN;
  delete process.env.REASON_SLACK_WEBHOOK_URL;
});

afterEach(async () => {
  defaultEventService.stop();
  while ((await defaultEventService.status()).polling) await new Promise((resolve) => setTimeout(resolve, 10));
  await rm(relayDir, { recursive: true, force: true });
});

const unusedApiConfig: CairnApiClientConfig = {
  baseUrl: "http://127.0.0.1:3100",
  fetchImpl: vi.fn(() => Promise.reject(new Error("Cairn API must not be called")))
};

function succeedWith(stdout: string): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, output: { stdout: string; stderr: string }) => void;
    callback(null, { stdout, stderr: "" });
  });
}

function resultBody(result: Awaited<ReturnType<typeof callTool>>): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("Reason Network compatibility commands", () => {
  beforeEach(() => {
    succeedWith('{"agents":["cursor"]}\n');
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: Writable;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) { callback(); },
        final(callback) {
          queueMicrotask(() => child.stdout.write('{"jsonrpc":"2.0","id":2,"result":{"content":[]}}\n'));
          callback();
        }
      });
      return child;
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["cairn_context_now", { cwd: "rn:who" }, "reason", ["network", "who", "--all", "--json"]],
    ["cairn_context_now", { cwd: "rn:send:cursor:hello:there" }, "/home/pi/.reason/bin/reason-network", ["send", "cursor", "hello:there", "--from", "dots"]],
    ["cairn_context_now", { cwd: "rn:send:reviewer@cursor:hello" }, "/home/pi/.reason/bin/reason-network", ["send", "cursor", "hello", "--from", "reviewer"]]
  ])("maps %s compatibility arguments to a fixed Reason session", async (tool, args, executable, cliArgs) => {
    const result = await callTool(unusedApiConfig, tool, args);

    expect(resultBody(result)).toEqual({ ok: true, data: { agents: ["cursor"] } });
    expect(execFileMock).toHaveBeenCalledWith(
      executable,
      cliArgs,
      expect.objectContaining({
        encoding: "utf8",
        env: expect.objectContaining({ PATH: expect.stringContaining(".local/bin") })
      }),
      expect.any(Function)
    );
  });

  it("asks and waits for the answer through the same fixed session", async () => {
    const result = await callTool(unusedApiConfig, "cairn_inbox", { cwd: "rn:ask:dots@cursor:status?" });

    expect(resultBody(result)).toEqual({ ok: true, data: { agents: ["cursor"] }, cachedMessages: [] });
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "/home/pi/.reason/bin/reason-network",
      ["send", "cursor", "status?", "--from", "dots"],
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "/home/pi/.reason/bin/reason-network",
      ["listen", "--as", "dots", "--wait", "20"],
      expect.objectContaining({ timeout: 25_000 }),
      expect.any(Function)
    );
  });

  it.each([
    ["rn:send:cursor", ["send", "cursor", "message body", "--from", "dots"]],
    ["rn:send:reviewer@cursor", ["send", "cursor", "message body", "--from", "reviewer"]]
  ])("routes observe title %s without writing an observation", async (title, cliArgs) => {
    const result = await callTool(unusedApiConfig, "cairn_observe", { title, body: "message body" });

    expect(resultBody(result)).toEqual({ ok: true, data: { agents: ["cursor"] } });
    expect(execFileMock).toHaveBeenCalledWith("/home/pi/.reason/bin/reason-network", cliArgs, expect.any(Object), expect.any(Function));
    expect(unusedApiConfig.fetchImpl).not.toHaveBeenCalled();
  });

  it("registers an unregistered named session and retries the send once", async () => {
    let call = 0;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, output: { stdout: string; stderr: string }) => void;
      call += 1;
      if (call === 1) {
        const error = Object.assign(new Error("send failed"), {
          stderr: "Error: this session isn't registered with Reason Network; restart the agent session, or use the reason-network tools"
        });
        callback(error, { stdout: "", stderr: error.stderr });
        return;
      }
      callback(null, { stdout: '{"sent":true}\n', stderr: "" });
    });

    const result = await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:send:cursor:hello" });

    expect(resultBody(result)).toEqual({ ok: true, data: { sent: true } });
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "/home/pi/.reason/bin/reason-network",
      ["listen", "--as", "dots", "--wait", "0"],
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      3,
      "/home/pi/.reason/bin/reason-network",
      ["send", "cursor", "hello", "--from", "dots"],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it.each([
    ["cairn_context_now", { cwd: 'rn:mcp:list_team:{"as":"dots"}' }, { as: "dots" }],
    ["cairn_inbox", { cwd: "rn:mcp:list_team" }, {}],
    ["cairn_observe", { title: "rn:mcp:list_team", body: '{"as":"dots"}' }, { as: "dots" }]
  ])("calls arbitrary Reason MCP tools through %s", async (tool, args, expectedArgs) => {
    const result = await callTool(unusedApiConfig, tool, args);

    expect(resultBody(result)).toEqual({ jsonrpc: "2.0", id: 2, result: { content: [] } });
    expect(spawnMock).toHaveBeenCalledWith(
      "/home/pi/.reason/bin/reason-network",
      ["mcp"],
      expect.objectContaining({
        env: expect.objectContaining({ REASON_NETWORK_SESSION: String("as" in expectedArgs ? expectedArgs.as : "dots") })
      })
    );
  });

  it("does not reuse the Reason CLI relay credential for remote-only MCP tools", async () => {
    const result = await callTool(unusedApiConfig, "cairn_inbox", { cwd: "rn:mcp:list_networks" });

    expect(result.isError).toBe(true);
    expect(resultBody(result)).toMatchObject({ ok: false });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("adds the Reason inbox to a normal context response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { now: "2026-10-25T00:00:00Z" } }), { status: 200 }));
    const result = await callTool({ baseUrl: "http://cairn.test", fetchImpl }, "cairn_context_now", { cwd: "/work" });

    expect(resultBody(result)).toMatchObject({
      ok: true,
      data: {
        ok: true,
        data: {
          now: "2026-10-25T00:00:00Z",
          reasonNetworkInbox: { ok: true, data: { session: "dots" }, cachedMessages: [] }
        }
      }
    });
  });

  it("keeps a normal context response successful when the Reason inbox fails", async () => {
    await writeFile(process.env.REASON_INBOX_CACHE_PATH!, "invalid-json");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { now: "2026-10-25T00:00:00Z" } }), { status: 200 }));
    const result = await callTool({ baseUrl: "http://cairn.test", fetchImpl }, "cairn_context_now", {});

    expect(result.isError).toBeUndefined();
    expect(resultBody(result)).toMatchObject({
      ok: true,
      data: { data: { reasonNetworkInbox: { ok: false, error: expect.any(String) } } }
    });
  });

  it.each(["pi-codex", "pi-claude-6"])("refuses rn:inbox:%s so a worker queue is never consumed", async (session) => {
    const result = await callTool(unusedApiConfig, "cairn_context_now", { cwd: `rn:inbox:${session}` });

    expect(result.isError).toBe(true);
    expect(resultBody(result)).toMatchObject({ ok: false, error: expect.stringContaining("reserved") });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("keeps cached messages through repeated reads until scoped ack", async () => {
    await writeFile(process.env.REASON_INBOX_CACHE_PATH!, JSON.stringify({
      version: 1,
      sessions: {
        dots: [
          { session: "dots", message_id: "m1", from: "zedd1324/cursor", agent: "cursor", text: "first", raw: "r1", receivedAt: "2026-10-25T00:00:00Z", unread: true },
          { session: "dots", message_id: "m0", from: "zedd1324/cursor", agent: "cursor", text: "old", raw: "r0", receivedAt: "2026-10-24T00:00:00Z", unread: false }
        ]
      },
      relay: { lastSentAt: null, lastError: null }
    }));

    const first = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:inbox" }));
    const second = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:inbox" }));

    expect(first).toEqual(second);
    expect(first.cachedMessages).toHaveLength(2);
    expect(execFileMock).not.toHaveBeenCalled();
    const wrongSession = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:ack:cursor:m1" }));
    expect(wrongSession).toMatchObject({ data: { acknowledged: false } });
    const ack = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:ack:zedd1324/dots:m1" }));
    expect(ack).toMatchObject({ data: { acknowledged: true, message_id: "m1", session: "dots" } });
    const third = resultBody(await callTool(unusedApiConfig, "cairn_inbox", { cwd: "rn:inbox:zedd1324/dots" }));
    expect(third.cachedMessages).toMatchObject([{ message_id: "m0" }]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("routes the MCP check_inbox bridge through the persistent queue", async () => {
    const result = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: 'rn:mcp:check_inbox:{"as":"claude-app"}' }));
    expect(result).toEqual({ ok: true, data: { session: "claude-app" }, cachedMessages: [] });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("stores a Slack token via cairn_observe rn:slack, reports status without secrets, and sends a test", async () => {
    const slackFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", slackFetch);

    const saved = resultBody(await callTool(unusedApiConfig, "cairn_observe", { title: "rn:slack", body: "xoxb-123-456-abc" }));
    const status = resultBody(await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:slack" }));
    const tested = await callTool(unusedApiConfig, "cairn_context_now", { cwd: "rn:slack:test" });

    expect(saved).toMatchObject({ ok: true, data: { configured: true, mode: "token", enabled: true, channelId: "C0CCT18TZEU" } });
    expect(JSON.stringify(status)).not.toContain("xoxb-");
    expect((await stat(process.env.REASON_SLACK_CONFIG_PATH!)).mode & 0o777).toBe(0o600);
    expect(tested.isError).toBeUndefined();
    expect(resultBody(tested)).toMatchObject({ ok: true, data: { sent: true, lastError: null, lastSentAt: expect.any(String) } });
    expect(slackFetch).toHaveBeenCalledWith("https://slack.com/api/chat.postMessage", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((slackFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { channel: string; text: string };
    expect(body.channel).toBe("C0CCT18TZEU");
    expect(body.text).toContain("Reason Network → zedd1324/dots");
  });
});
