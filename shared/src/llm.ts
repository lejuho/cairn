import { z } from "zod";

export const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string()
});

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(ChatMessageSchema).min(1),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    mock: z.boolean().optional()
  })
  .passthrough();

export const ChatCompletionResponseSchema = z
  .object({
    id: z.string().min(1),
    object: z.literal("chat.completion"),
    created: z.number().int().nonnegative(),
    model: z.string().min(1),
    choices: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.object({
          role: z.literal("assistant"),
          content: z.string()
        }),
        finish_reason: z.string().nullable()
      })
    ),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative(),
        completion_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative()
      })
      .optional()
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
