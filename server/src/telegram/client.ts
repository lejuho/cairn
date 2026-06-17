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
}): TelegramClient {
  const fetchImpl = input.fetchImpl ?? fetch;
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
