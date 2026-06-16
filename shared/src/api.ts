import { z } from "zod";

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});

export const createApiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data
  });

export const createApiFailureSchema = <T extends z.ZodTypeAny>(error: T) =>
  z.object({
    ok: z.literal(false),
    error
  });

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure<T = z.infer<typeof ApiErrorSchema>> = {
  ok: false;
  error: T;
};

export type ApiResult<T, E = z.infer<typeof ApiErrorSchema>> =
  | ApiSuccess<T>
  | ApiFailure<E>;
