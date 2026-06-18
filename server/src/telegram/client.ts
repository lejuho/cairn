import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";

const TelegramResponseEnvelopeSchema = z.object({
  ok: z.boolean()
});

const TelegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      message_id: z.number().int().nonnegative(),
      text: z.string().optional(),
      chat: z.object({
        id: z.union([z.number().int(), z.string()])
      }),
      reply_to_message: z
        .object({
          message_id: z.number().int().nonnegative()
        })
        .optional()
    })
    .optional()
});

const GetUpdatesResponseSchema = z.object({
  ok: z.literal(true),
  result: z.array(TelegramUpdateSchema)
});

const SendMessageResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    message_id: z.number().int().nonnegative()
  })
});

export type TelegramUpdate = {
  updateId: number;
  message:
    | {
        messageId: number;
        text: string | null;
        chatId: string;
        replyToMessageId: number | null;
      }
    | null;
};

export type TelegramClient = {
  getUpdates(input: {
    offset?: number;
    timeoutSeconds: number;
  }): Promise<TelegramUpdate[]>;
  sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
  }): Promise<{ messageId: number }>;
};

export function createTelegramClient(input: {
  botToken: string;
  fetchImpl?: typeof fetch;
  forceIpv4?: boolean;
}): TelegramClient {
  const fetchImpl = input.fetchImpl ?? (input.forceIpv4 === true ? fetchIpv4 : fetch);
  const baseUrl = `https://api.telegram.org/bot${input.botToken}`;

  return {
    async getUpdates({ offset, timeoutSeconds }) {
      const url = new URL(`${baseUrl}/getUpdates`);
      if (offset !== undefined) {
        url.searchParams.set("offset", String(offset));
      }
      url.searchParams.set("timeout", String(timeoutSeconds));
      url.searchParams.set("allowed_updates", JSON.stringify(["message"]));

      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Telegram getUpdates failed with status ${response.status}`);
      }

      const payload: unknown = await response.json();
      const envelope = TelegramResponseEnvelopeSchema.safeParse(payload);
      if (!envelope.success || envelope.data.ok !== true) {
        throw new Error("Telegram getUpdates returned an invalid envelope");
      }

      const parsed = GetUpdatesResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("Telegram getUpdates returned an invalid payload");
      }

      return parsed.data.result.map((update) => ({
        updateId: update.update_id,
        message: update.message
          ? {
              messageId: update.message.message_id,
              text: update.message.text ?? null,
              chatId: String(update.message.chat.id),
              replyToMessageId: update.message.reply_to_message?.message_id ?? null
            }
          : null
      }));
    },

    async sendMessage({ chatId, text, replyToMessageId }) {
      const response = await fetchImpl(`${baseUrl}/sendMessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyToMessageId === undefined ? {} : { reply_to_message_id: replyToMessageId })
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram sendMessage failed with status ${response.status}`);
      }

      const payload: unknown = await response.json();
      const envelope = TelegramResponseEnvelopeSchema.safeParse(payload);
      if (!envelope.success || envelope.data.ok !== true) {
        throw new Error("Telegram sendMessage returned an invalid envelope");
      }

      const parsed = SendMessageResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("Telegram sendMessage returned an invalid payload");
      }

      return { messageId: parsed.data.result.message_id };
    }
  };
}

function fetchIpv4(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const headers = normalizeRequestHeaders(init?.headers);
  const body = normalizeRequestBody(init?.body);

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method,
        family: 4,
        headers,
        timeout: 30_000
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(new Response(Buffer.concat(chunks), {
            status: res.statusCode ?? 500,
            headers: normalizeResponseHeaders(res.headers)
          }));
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Telegram IPv4 request timed out"));
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

function normalizeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) return {};
  const normalized: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}

function normalizeRequestBody(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body === null || body === undefined) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  throw new TypeError("Telegram IPv4 fetch only supports buffered request bodies");
}

function normalizeResponseHeaders(headers: IncomingHttpHeaders): Headers {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) normalized.append(key, item);
    } else if (value !== undefined) {
      normalized.set(key, String(value));
    }
  }
  return normalized;
}
