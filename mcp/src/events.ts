import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { isJsonObject, type JsonObject, type JsonValue } from "./json.js";
import { defaultReasonRelay, QUEUED_REASON_SESSIONS, RESERVED_REASON_SESSIONS, type ReasonRelay } from "./reason-relay.js";

const execFileAsync = promisify(execFile);
const EVENT_NAME = "reason.message.created";
const DEFAULT_SESSION = "dots";
const DEFAULT_STORE_PATH = "/home/pi/cairn-data/mcp-event-subscriptions.json";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_TTL_MS = DEFAULT_TTL_MS;
const VERIFY_CACHE_MS = 10 * 60 * 1_000;
const POLL_INTERVAL_MS = 3_000;
const CALLBACK_TIMEOUT_MS = 10_000;

export const REASON_MESSAGE_EVENT: JsonObject = {
  name: EVENT_NAME,
  description: "A new message arrived in a Reason Network session inbox (default session: dots).",
  delivery: ["webhook"],
  inputSchema: {
    type: "object",
    properties: {
      session: {
        type: "string",
        description: "Reason Network session name to monitor (default: dots)."
      }
    },
    additionalProperties: false
  },
  payloadSchema: {
    type: "object",
    properties: {
      session: { type: "string" },
      message_id: { type: "string" },
      from: { type: "string" },
      agent: { type: "string" },
      text: { type: "string" },
      raw: { type: "string" }
    },
    required: ["session", "from", "text"],
    additionalProperties: false
  }
};

type EventDelivery = {
  mode: "webhook";
  url: string;
  secret: string;
};

type EventSubscription = {
  id: string;
  name: typeof EVENT_NAME;
  arguments: { session: string };
  delivery: EventDelivery;
  refreshBefore: string | null;
  createdAt: string;
  updatedAt: string;
};

interface SubscriptionStore {
  version: 1;
  subscriptions: EventSubscription[];
}

export interface ReasonMessage {
  session: string;
  message_id: string;
  from: string;
  agent: string;
  text: string;
  raw: string;
}

export interface EventWatcherStatus {
  running: boolean;
  polling: boolean;
  activeSubscriptions: number;
  slackRelayActive: boolean;
  sessions: string[];
  lastPollAt: string | null;
  lastError: string | null;
  subscriptions: Array<{
    id: string;
    name: string;
    session: string;
    url: string;
    refreshBefore: string | null;
  }>;
}

export interface McpEventServiceOptions {
  storePath?: string;
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  listen?: (session: string) => Promise<string>;
  relay?: ReasonRelay;
  now?: () => Date;
  pollIntervalMs?: number;
  callbackTimeoutMs?: number;
}

export class McpEventError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: JsonObject
  ) {
    super(message);
    this.name = "McpEventError";
  }
}

export class McpEventService {
  private readonly storePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveHost: (hostname: string) => Promise<string[]>;
  private readonly listen: (session: string) => Promise<string>;
  private readonly relay: ReasonRelay;
  private readonly now: () => Date;
  private readonly pollIntervalMs: number;
  private readonly callbackTimeoutMs: number;
  private readonly verifiedUrls = new Map<string, number>();
  private readonly pendingWrites = new Map<string, ReasonMessage[]>();
  private readonly seenEventIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private persistent = false;
  private watcherGeneration = 0;
  private polling = false;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: McpEventServiceOptions = {}) {
    this.storePath = options.storePath ?? process.env.MCP_EVENT_STORE_PATH ?? DEFAULT_STORE_PATH;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveHost = options.resolveHost ?? resolvePublicAddresses;
    this.listen = options.listen ?? listenToReasonSession;
    this.relay = options.relay ?? defaultReasonRelay;
    this.now = options.now ?? (() => new Date());
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.callbackTimeoutMs = options.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS;
  }

  list(): JsonObject {
    return { events: [REASON_MESSAGE_EVENT] };
  }

  async subscribe(params: JsonValue | undefined): Promise<JsonObject> {
    const input = parseSubscribeParams(params);
    await this.validateCallbackUrl(input.delivery.url);
    const key = decodeWebhookSecret(input.delivery.secret);
    const id = subscriptionId(input.name, input.arguments, input.delivery.url);
    await this.verifyCallback(id, input.delivery, key);

    const now = this.now();
    const ttlMs = input.ttlMs === null ? null : Math.min(input.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS);
    const refreshBefore = ttlMs === null ? null : new Date(now.getTime() + ttlMs).toISOString();
    const store = await this.readStore();
    const existing = store.subscriptions.find((subscription) => subscription.id === id);
    const subscription: EventSubscription = {
      id,
      name: EVENT_NAME,
      arguments: input.arguments,
      delivery: input.delivery,
      refreshBefore,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString()
    };
    store.subscriptions = [...store.subscriptions.filter((item) => item.id !== id), subscription];
    await this.writeStore(store);
    this.ensureWatcher();
    return { id, refreshBefore, cursor: null, truncated: false };
  }

  async unsubscribe(params: JsonValue | undefined): Promise<JsonObject> {
    const input = parseUnsubscribeParams(params);
    const id = subscriptionId(input.name, input.arguments, input.delivery.url);
    const store = await this.readStore();
    const next = store.subscriptions.filter((subscription) => subscription.id !== id);
    if (next.length !== store.subscriptions.length) {
      store.subscriptions = next;
      await this.writeStore(store);
    }
    if (!this.persistent && !(await this.hasWork())) this.stopWatcher();
    return {};
  }

  /** Keeps the watcher ticking for the process lifetime so a later Slack config or subscription is picked up. */
  start(): void {
    this.persistent = true;
    this.ensureWatcher();
  }

  /** Starts an idle-stopping watcher; used when another process may own the persistent one. */
  wake(): void {
    this.ensureWatcher();
  }

  stop(): void {
    this.persistent = false;
    this.stopWatcher();
  }

  async status(): Promise<EventWatcherStatus> {
    const active = await this.activeSubscriptions();
    const slackRelayActive = await this.relay.isActive();
    return {
      running: this.timer !== undefined,
      polling: this.polling,
      activeSubscriptions: active.length,
      slackRelayActive,
      sessions: pollSessions(active),
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      subscriptions: active.map((subscription) => ({
        id: subscription.id,
        name: subscription.name,
        session: subscription.arguments.session,
        url: subscription.delivery.url,
        refreshBefore: subscription.refreshBefore
      }))
    };
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      let deliveryError: string | null = null;
      const active = await this.activeSubscriptions();
      const slackRelayActive = await this.relay.isActive();
      for (const session of pollSessions(active)) {
        let messages = this.pendingWrites.get(session);
        try {
          if (!messages) {
            // Do not consume upstream if the existing queue cannot be opened/written.
            await this.relay.checkWritable();
            const output = await this.listen(session);
            messages = parseReasonMessages(output, session).filter((message) => !this.seenEventIds.has(reasonEventId(message)));
            this.pendingWrites.set(session, messages);
          }
          // The shared durable queue elects one notifier, including across restarts.
          messages = await this.relay.cacheMessages(messages);
          this.pendingWrites.delete(session);
        } catch (error) {
          deliveryError = `Inbox ${session} failed: ${error instanceof Error ? error.message : "unknown error"}`;
          continue;
        }
        for (const message of messages) {
          const eventId = reasonEventId(message);
          if (slackRelayActive && session === DEFAULT_SESSION) {
            try {
              await this.relay.notify(message);
            } catch (error) {
              deliveryError = `Slack relay failed: ${error instanceof Error ? error.message : "unknown error"}`;
            }
          }
          for (const subscription of active.filter((item) => item.arguments.session === session)) {
            try {
              await this.deliver(subscription, eventId, message);
            } catch (error) {
              deliveryError = `Delivery ${subscription.id} failed: ${error instanceof Error ? error.message : "unknown error"}`;
            }
          }
          this.rememberEvent(eventId);
        }
      }
      this.lastError = deliveryError;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown event watcher error";
    } finally {
      this.lastPollAt = this.now().toISOString();
      this.polling = false;
    }
  }

  private ensureWatcher(): void {
    if (this.timer !== undefined) return;
    const generation = this.watcherGeneration;
    const tick = async (): Promise<void> => {
      await this.pollOnce();
      let keepRunning = true;
      try {
        keepRunning = this.persistent || await this.hasWork();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "Unknown event watcher error";
      }
      // stop() during an in-flight poll must not be undone by this tick rescheduling itself.
      if (generation !== this.watcherGeneration) return;
      if (!keepRunning) {
        this.timer = undefined;
        return;
      }
      this.timer = setTimeout(() => void tick(), this.pollIntervalMs);
      this.timer.unref?.();
    };
    this.timer = setTimeout(() => void tick(), 0);
    this.timer.unref?.();
  }

  private stopWatcher(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.watcherGeneration += 1;
  }

  private async hasWork(): Promise<boolean> {
    return (await this.activeSubscriptions()).length > 0 || await this.relay.isActive();
  }

  private async activeSubscriptions(): Promise<EventSubscription[]> {
    const store = await this.readStore();
    const now = this.now().getTime();
    const active = store.subscriptions.filter((subscription) =>
      subscription.refreshBefore === null || Date.parse(subscription.refreshBefore) > now
    );
    if (active.length !== store.subscriptions.length) {
      store.subscriptions = active;
      await this.writeStore(store);
    }
    return active;
  }

  private async verifyCallback(id: string, delivery: EventDelivery, key: Buffer): Promise<void> {
    const cacheUntil = this.verifiedUrls.get(delivery.url) ?? 0;
    if (cacheUntil > this.now().getTime()) return;
    const challenge = randomBytes(24).toString("base64url");
    const body = JSON.stringify({ type: "verification", challenge });
    const webhookId = `msg_verification_${randomBytes(12).toString("hex")}`;
    try {
      const response = await this.signedPost(delivery.url, id, webhookId, body, key);
      if (!response.ok) throw new Error(`Callback returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!isJsonObject(payload) || typeof payload.challenge !== "string" || !safeEqual(challenge, payload.challenge)) {
        throw new Error("Callback challenge did not match");
      }
      this.verifiedUrls.set(delivery.url, this.now().getTime() + VERIFY_CACHE_MS);
    } catch (error) {
      const reason = isTimeoutError(error) ? "timeout" : "challenge_failed";
      throw new McpEventError(-32015, "CallbackEndpointError", { reason });
    }
  }

  private async deliver(subscription: EventSubscription, eventId: string, message: ReasonMessage): Promise<void> {
    await this.validateCallbackUrl(subscription.delivery.url);
    const body = JSON.stringify({
      eventId,
      name: EVENT_NAME,
      timestamp: this.now().toISOString(),
      data: message,
      cursor: null
    });
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.signedPost(
          subscription.delivery.url,
          subscription.id,
          eventId,
          body,
          decodeWebhookSecret(subscription.delivery.secret)
        );
        if (response.ok) return;
        lastError = new Error(`Callback returned HTTP ${response.status}`);
        if (response.status === 410 || response.status === 413 || (response.status >= 400 && response.status < 500 && response.status !== 429)) break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown callback error");
      }
      if (attempt < 2) await delay(100 * (2 ** attempt));
    }
    throw lastError ?? new Error("Callback delivery failed");
  }

  private rememberEvent(eventId: string): void {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size <= 10_000) return;
    const oldest = this.seenEventIds.values().next().value;
    if (oldest !== undefined) this.seenEventIds.delete(oldest);
  }

  private async signedPost(url: string, subscriptionId: string, webhookId: string, body: string, key: Buffer): Promise<Response> {
    const timestamp = Math.floor(this.now().getTime() / 1_000).toString();
    const signature = createHmac("sha256", key).update(`${webhookId}.${timestamp}.${body}`).digest("base64");
    return this.fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "webhook-id": webhookId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
        "X-MCP-Subscription-Id": subscriptionId
      },
      body,
      signal: AbortSignal.timeout(this.callbackTimeoutMs)
    });
  }

  private async validateCallbackUrl(rawUrl: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw invalidParams("delivery.url must be a valid HTTPS URL");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost") {
      throw invalidParams("delivery.url must be a public HTTPS URL");
    }
    let addresses: string[];
    try {
      addresses = isIP(url.hostname) ? [url.hostname] : await this.resolveHost(url.hostname);
    } catch {
      throw invalidParams("delivery.url hostname could not be resolved");
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw invalidParams("delivery.url must not resolve to a private or local address");
    }
  }

  private async readStore(): Promise<SubscriptionStore> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.storePath, "utf8"));
      if (!isJsonObject(parsed) || !Array.isArray(parsed.subscriptions)) return emptyStore();
      return {
        version: 1,
        subscriptions: parsed.subscriptions.filter(isStoredSubscription)
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  private async writeStore(store: SubscriptionStore): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, this.storePath);
    await chmod(this.storePath, 0o600);
  }
}

export const defaultEventService = new McpEventService();

export function parseReasonMessages(output: string, session: string): ReasonMessage[] {
  const messages: ReasonMessage[] = [];
  const pattern = /(?:<|\[)reason-message\s+([^>\]]*?)>([\s\S]*?)(?:<\/reason-message>|\[\/reason-message[>\]])/g;
  for (const match of output.matchAll(pattern)) {
    const raw = match[0];
    const attributes = parseAttributes(match[1] ?? "");
    const text = (match[2] ?? "").trim();
    if (!attributes.from || !text) continue;
    messages.push({
      session,
      message_id: attributes.id ?? "",
      from: attributes.from,
      agent: attributes.agent ?? "",
      text,
      raw
    });
  }
  return messages;
}

function parseSubscribeParams(value: JsonValue | undefined): {
  name: typeof EVENT_NAME;
  arguments: { session: string };
  delivery: EventDelivery;
  ttlMs: number | null | undefined;
} {
  if (!isJsonObject(value)) throw invalidParams("events/subscribe params must be an object");
  const common = parseCommonParams(value, true);
  const ttlMs = value.ttlMs;
  if (ttlMs !== undefined && ttlMs !== null && (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0)) {
    throw invalidParams("ttlMs must be a positive number or null");
  }
  if (value.cursor !== undefined && value.cursor !== null && typeof value.cursor !== "string") {
    throw invalidParams("cursor must be a string or null");
  }
  return { ...common, ttlMs };
}

function parseUnsubscribeParams(value: JsonValue | undefined): {
  name: typeof EVENT_NAME;
  arguments: { session: string };
  delivery: Pick<EventDelivery, "mode" | "url">;
} {
  if (!isJsonObject(value)) throw invalidParams("events/unsubscribe params must be an object");
  return parseCommonParams(value, false);
}

function parseCommonParams(value: JsonObject, requireSecret: true): {
  name: typeof EVENT_NAME;
  arguments: { session: string };
  delivery: EventDelivery;
};
function parseCommonParams(value: JsonObject, requireSecret: false): {
  name: typeof EVENT_NAME;
  arguments: { session: string };
  delivery: Pick<EventDelivery, "mode" | "url">;
};
function parseCommonParams(value: JsonObject, requireSecret: boolean) {
  if (value.name !== EVENT_NAME) throw invalidParams(`Unsupported event: ${String(value.name)}`);
  const args = value.arguments === undefined ? {} : value.arguments;
  if (!isJsonObject(args) || Object.keys(args).some((key) => key !== "session")) {
    throw invalidParams("arguments must contain only session");
  }
  const session = args.session === undefined ? DEFAULT_SESSION : args.session;
  if (typeof session !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(session) || RESERVED_REASON_SESSIONS.has(session)) {
    throw invalidParams("arguments.session is invalid or reserved");
  }
  if (!isJsonObject(value.delivery) || value.delivery.mode !== "webhook" || typeof value.delivery.url !== "string") {
    throw invalidParams("delivery must specify webhook mode and a URL");
  }
  if (requireSecret) {
    if (typeof value.delivery.secret !== "string") throw invalidParams("delivery.secret is required");
    decodeWebhookSecret(value.delivery.secret);
    return { name: EVENT_NAME, arguments: { session }, delivery: { mode: "webhook", url: value.delivery.url, secret: value.delivery.secret } };
  }
  return { name: EVENT_NAME, arguments: { session }, delivery: { mode: "webhook", url: value.delivery.url } };
}

function decodeWebhookSecret(secret: string): Buffer {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : "";
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw invalidParams("delivery.secret must be whsec_ followed by base64");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length < 24 || key.length > 64 || key.toString("base64") !== encoded) {
    throw invalidParams("delivery.secret must decode to 24-64 bytes");
  }
  return key;
}

function subscriptionId(name: string, args: { session: string }, url: string): string {
  const canonical = JSON.stringify([name, canonicalJson(args), url]);
  return `sub_${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
}

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key]!)]));
}

function pollSessions(active: EventSubscription[]): string[] {
  const sessions = new Set<string>([...QUEUED_REASON_SESSIONS, ...active.map((subscription) => subscription.arguments.session)]);
  return [...sessions].sort();
}

function reasonEventId(message: ReasonMessage): string {
  if (message.message_id) return `evt_${message.session}_${message.message_id}`;
  return `evt_${createHash("sha256").update(`${message.session}\n${message.raw}`).digest("hex").slice(0, 24)}`;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)="([^"]*)"/g)) {
    attributes[match[1]!] = match[2]!;
  }
  return attributes;
}

async function resolvePublicAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]!;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return octets[0] === 127 || octets[0] === 10 ||
      (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254) || octets[0] === 0;
  }
  if (isIP(normalized) === 6) {
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized);
  }
  return true;
}

async function listenToReasonSession(session: string): Promise<string> {
  if (RESERVED_REASON_SESSIONS.has(session)) throw new Error(`Refusing to run Reason listener as reserved session ${session}`);
  const { stdout } = await execFileAsync(
    "/home/pi/.reason/bin/reason-network",
    ["listen", "--as", session, "--wait", "0"],
    { encoding: "utf8", timeout: 15_000 }
  );
  return stdout;
}

function isStoredSubscription(value: unknown): value is EventSubscription {
  return isJsonObject(value) && typeof value.id === "string" && value.name === EVENT_NAME &&
    isJsonObject(value.arguments) && typeof value.arguments.session === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value.arguments.session) && !RESERVED_REASON_SESSIONS.has(value.arguments.session) &&
    isJsonObject(value.delivery) && value.delivery.mode === "webhook" &&
    typeof value.delivery.url === "string" && typeof value.delivery.secret === "string" &&
    (value.refreshBefore === null || typeof value.refreshBefore === "string") &&
    typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function emptyStore(): SubscriptionStore {
  return { version: 1, subscriptions: [] };
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function invalidParams(message: string): McpEventError {
  return new McpEventError(-32602, message);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
