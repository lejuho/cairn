import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReasonMessage } from "./events.js";
import { isJsonObject, ToolInputError, type JsonObject } from "./json.js";

const DEFAULT_CONFIG_PATH = "/home/pi/cairn-data/reason-slack.json";
const DEFAULT_CACHE_PATH = "/home/pi/cairn-data/reason-inbox-cache.json";
const DEFAULT_CHANNEL_ID = "C0CCT18TZEU";
const DEFAULT_OWNER = "zedd1324";
export const QUEUED_REASON_SESSIONS = ["claude-app", "cursor", "dots", "muse"] as const;
const MAX_SLACK_BODY_CHARS = 35_000;
const SLACK_TIMEOUT_MS = 10_000;
const WEBHOOK_PREFIX = "https://hooks.slack.com/services/";
const BOT_TOKEN_PATTERN = /^xox[bp]-[A-Za-z0-9-]+$/;
const CHANNEL_PATTERN = /^[CGD][A-Z0-9]{6,}$/;

/** Sessions owned by resident Reason workers; listening as them would steal their queue. */
export const RESERVED_REASON_SESSIONS: ReadonlySet<string> = new Set(["pi-codex", "pi-claude-6"]);

export type SlackRelayMode = "webhook" | "token" | "none";

export interface SlackRelayConfig {
  enabled: boolean;
  mode: SlackRelayMode;
  webhookUrl: string | null;
  botToken: string | null;
  channelId: string;
}

export interface CachedReasonMessage extends ReasonMessage {
  receivedAt: string;
  unread: boolean;
}

interface InboxCache {
  version: 1;
  sessions: Record<string, CachedReasonMessage[]>;
  acknowledged: Record<string, string[]>;
  relay: { lastSentAt: string | null; lastError: string | null };
}

export interface ReasonRelayOptions {
  configPath?: string;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class ReasonRelay {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private cacheQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ReasonRelayOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
  }

  // Resolved per call so tests and service env can redirect paths after import.
  private get configPath(): string {
    return this.options.configPath ?? process.env.REASON_SLACK_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  }

  private get cachePath(): string {
    return this.options.cachePath ?? process.env.REASON_INBOX_CACHE_PATH ?? DEFAULT_CACHE_PATH;
  }

  async config(): Promise<SlackRelayConfig> {
    const file = await this.readConfigFile();
    const botToken = stringOrNull(file.botToken) ?? stringOrNull(process.env.REASON_SLACK_BOT_TOKEN);
    const webhookUrl = stringOrNull(file.webhookUrl) ?? stringOrNull(process.env.REASON_SLACK_WEBHOOK_URL);
    const channelId = stringOrNull(file.channelId) ?? stringOrNull(process.env.REASON_SLACK_CHANNEL_ID) ?? DEFAULT_CHANNEL_ID;
    const mode: SlackRelayMode = botToken && BOT_TOKEN_PATTERN.test(botToken)
      ? "token"
      : webhookUrl && webhookUrl.startsWith(WEBHOOK_PREFIX) ? "webhook" : "none";
    const enabled = typeof file.enabled === "boolean" ? file.enabled : mode !== "none";
    return { enabled, mode, webhookUrl, botToken, channelId };
  }

  async isActive(): Promise<boolean> {
    const config = await this.config();
    return config.enabled && config.mode !== "none";
  }

  async status(): Promise<JsonObject> {
    const [config, cache] = await Promise.all([this.config(), this.readCache()]);
    return {
      configured: config.mode !== "none",
      mode: config.mode,
      channelId: config.channelId,
      enabled: config.enabled,
      lastSentAt: cache.relay.lastSentAt,
      lastError: cache.relay.lastError,
      cachedUnreadCount: Object.values(cache.sessions).reduce(
        (total, messages) => total + messages.filter((message) => message.unread).length,
        0
      )
    };
  }

  /** Accepts a webhook URL, a bot/user token, or JSON {webhookUrl|botToken, channelId?, enabled?}. */
  async saveConfig(body: unknown): Promise<JsonObject> {
    if (typeof body !== "string" || body.trim().length === 0) throw new ToolInputError("body must be a Slack webhook URL, token, or JSON");
    const input = parseConfigBody(body.trim());
    const current = await this.readConfigFile();
    // A new credential replaces the old one; {"enabled": false} alone keeps it for later re-enable.
    const credential: JsonObject = input.botToken
      ? { botToken: input.botToken }
      : input.webhookUrl
        ? { webhookUrl: input.webhookUrl }
        : {
            ...(typeof current.botToken === "string" ? { botToken: current.botToken } : {}),
            ...(typeof current.webhookUrl === "string" ? { webhookUrl: current.webhookUrl } : {})
          };
    const next: JsonObject = {
      enabled: input.enabled ?? true,
      channelId: input.channelId ?? stringOrNull(current.channelId) ?? DEFAULT_CHANNEL_ID,
      ...credential
    };
    await writePrivateJson(this.configPath, next);
    return this.status();
  }

  async notify(message: ReasonMessage): Promise<void> {
    await this.post(formatSlackMessage(message));
  }

  async sendTest(): Promise<JsonObject> {
    const at = this.now().toISOString();
    await this.post(`🔔 *[Reason Network → ${DEFAULT_OWNER}/dots]*\n• *Test:* Cairn Slack relay check at \`${at}\``);
    return this.status();
  }

  async checkWritable(): Promise<void> {
    await this.updateCache(() => undefined);
  }

  async cacheMessages(messages: ReasonMessage[]): Promise<ReasonMessage[]> {
    if (messages.length === 0) return [];
    const accepted: ReasonMessage[] = [];
    await this.updateCache((cache) => {
      const receivedAt = this.now().toISOString();
      for (let message of messages) {
        const existing = cache.sessions[message.session] ?? [];
        message = { ...message, message_id: message.message_id || createHash("sha256").update(message.raw).digest("hex") };
        if ((cache.acknowledged[message.session] ?? []).includes(message.message_id) ||
          existing.some((item) => sameMessage(item, message))) continue;
        accepted.push(message);
        cache.sessions[message.session] = [...existing, { ...message, receivedAt, unread: true }];
      }
    });
    return accepted;
  }

  /** Reads never acknowledge. All persisted messages remain pending until explicit ack. */
  async readPending(session: string): Promise<CachedReasonMessage[]> {
    await this.cacheQueue;
    return (await this.readCache()).sessions[session] ?? [];
  }

  async acknowledge(session: string, id: string): Promise<boolean> {
    let removed = false;
    await this.updateCache((cache) => {
      const messages = cache.sessions[session] ?? [];
      const remaining = messages.filter((message) => message.message_id !== id);
      removed = remaining.length !== messages.length;
      if (removed) {
        cache.sessions[session] = remaining;
        cache.acknowledged[session] = [...(cache.acknowledged[session] ?? []), id];
      }
      return removed;
    });
    return removed;
  }

  private async post(text: string): Promise<void> {
    const config = await this.config();
    try {
      if (config.mode === "none") throw new Error("Slack relay is not configured");
      if (config.mode === "token") {
        const response = await this.fetchImpl("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { authorization: `Bearer ${config.botToken}`, "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ channel: config.channelId, text }),
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok || !isJsonObject(payload) || payload.ok !== true) {
          const reason = isJsonObject(payload) && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
          throw new Error(`Slack chat.postMessage failed: ${reason}`);
        }
      } else {
        const response = await this.fetchImpl(config.webhookUrl!, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`Slack webhook failed: HTTP ${response.status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown Slack error";
      await this.updateCache((cache) => { cache.relay.lastError = message; });
      throw new Error(message);
    }
    await this.updateCache((cache) => {
      cache.relay.lastSentAt = this.now().toISOString();
      cache.relay.lastError = null;
    });
  }

  private async readConfigFile(): Promise<JsonObject> {
    try {
      const raw = await readFile(this.configPath, "utf8");
      await tightenMode(this.configPath);
      const parsed: unknown = JSON.parse(raw);
      return isJsonObject(parsed) ? parsed : {};
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return {};
      throw error;
    }
  }

  // Serialized so the watcher and tool calls in one process never interleave read-modify-write.
  private updateCache(mutate: (cache: InboxCache) => boolean | void): Promise<void> {
    const run = this.cacheQueue.then(async () => {
      const path = this.cachePath;
      await mkdir(dirname(path), { recursive: true });
      // Kernel lock releases even if either MCP process crashes. Never unlink the lock file.
      const release = await acquireCacheLock(`${path}.flock`);
      try {
        const cache = await this.readCache();
        if (mutate(cache) === false) return;
        await writePrivateJson(path, cache);
      } finally { await release(); }
    });
    this.cacheQueue = run.catch(() => undefined);
    return run;
  }

  private async readCache(): Promise<InboxCache> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.cachePath, "utf8"));
      if (!isJsonObject(parsed)) return emptyCache();
      const sessions: Record<string, CachedReasonMessage[]> = {};
      if (isJsonObject(parsed.sessions)) {
        for (const [session, messages] of Object.entries(parsed.sessions)) {
          if (Array.isArray(messages)) sessions[session] = (messages as unknown[]).filter(isCachedMessage).map((message) => ({ ...message, unread: true, message_id: message.message_id || createHash("sha256").update(message.raw).digest("hex") }));
        }
      }
      const acknowledged: Record<string, string[]> = {};
      if (isJsonObject(parsed.acknowledged)) {
        for (const [session, ids] of Object.entries(parsed.acknowledged)) {
          if (Array.isArray(ids)) acknowledged[session] = ids.filter((id): id is string => typeof id === "string");
        }
      }
      const relay: JsonObject = isJsonObject(parsed.relay) ? parsed.relay : {};
      return {
        version: 1,
        sessions,
        acknowledged,
        relay: { lastSentAt: stringOrNull(relay.lastSentAt), lastError: stringOrNull(relay.lastError) }
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return emptyCache();
      throw error;
    }
  }
}

export const defaultReasonRelay = new ReasonRelay();

export function formatSlackMessage(message: ReasonMessage): string {
  const body = message.text.length > MAX_SLACK_BODY_CHARS ? `${message.text.slice(0, MAX_SLACK_BODY_CHARS)}…` : message.text;
  return [
    `🔔 *[Reason Network → ${DEFAULT_OWNER}/${message.session}]*`,
    `• *From:* \`${slackEscape(message.from)}\` (\`${slackEscape(message.agent)}\`)`,
    `• *Message ID:* \`${slackEscape(message.message_id)}\``,
    "• *Body:*",
    slackEscape(body)
  ].join("\n");
}

function parseConfigBody(body: string): { botToken?: string; webhookUrl?: string; channelId?: string; enabled?: boolean } {
  let input: { botToken?: string; webhookUrl?: string; channelId?: string; enabled?: boolean };
  if (body.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new ToolInputError("Slack config JSON is invalid");
    }
    if (!isJsonObject(parsed)) throw new ToolInputError("Slack config JSON must be an object");
    input = {
      ...(typeof parsed.botToken === "string" ? { botToken: parsed.botToken.trim() } : {}),
      ...(typeof parsed.webhookUrl === "string" ? { webhookUrl: parsed.webhookUrl.trim() } : {}),
      ...(typeof parsed.channelId === "string" ? { channelId: parsed.channelId.trim() } : {}),
      ...(typeof parsed.enabled === "boolean" ? { enabled: parsed.enabled } : {})
    };
  } else if (body.startsWith("xox")) {
    input = { botToken: body };
  } else {
    input = { webhookUrl: body };
  }
  if (input.botToken !== undefined && !BOT_TOKEN_PATTERN.test(input.botToken)) {
    throw new ToolInputError("botToken must be an xoxb- or xoxp- Slack token");
  }
  if (input.webhookUrl !== undefined && !input.webhookUrl.startsWith(WEBHOOK_PREFIX)) {
    throw new ToolInputError(`webhookUrl must start with ${WEBHOOK_PREFIX}`);
  }
  if (input.channelId !== undefined && !CHANNEL_PATTERN.test(input.channelId)) {
    throw new ToolInputError("channelId must be a Slack channel ID such as C0CCT18TZEU");
  }
  if (!input.botToken && !input.webhookUrl && input.enabled === undefined) {
    throw new ToolInputError("Slack config needs a webhookUrl, botToken, or enabled flag");
  }
  return input;
}

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sameMessage(left: ReasonMessage, right: ReasonMessage): boolean {
  return left.message_id ? left.message_id === right.message_id : left.raw === right.raw;
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

async function tightenMode(path: string): Promise<void> {
  try {
    if (((await stat(path)).mode & 0o077) !== 0) await chmod(path, 0o600);
  } catch {
    // Best effort: a read-only mount must not disable the relay.
  }
}

function isCachedMessage(value: unknown): value is CachedReasonMessage {
  return isJsonObject(value) && typeof value.session === "string" && typeof value.message_id === "string" &&
    typeof value.from === "string" && typeof value.agent === "string" && typeof value.text === "string" &&
    typeof value.raw === "string" && typeof value.receivedAt === "string" && typeof value.unread === "boolean";
}

function emptyCache(): InboxCache {
  return { version: 1, sessions: {}, acknowledged: {}, relay: { lastSentAt: null, lastError: null } };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function acquireCacheLock(path: string): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const child = spawn("flock", ["--exclusive", "--timeout", "5", path, "sh", "-c", "printf locked; cat >/dev/null"], {
      stdio: ["pipe", "pipe", "ignore"]
    });
    let acquired = false;
    const closed = new Promise<void>((done) => child.once("close", () => done()));
    child.once("error", reject);
    child.once("close", (code) => {
      if (!acquired) reject(new Error(`Inbox cache lock failed (${code}): ${path}`));
    });
    child.stdout.once("data", () => {
      acquired = true;
      resolve(async () => { child.stdin.end(); await closed; });
    });
  });
}
