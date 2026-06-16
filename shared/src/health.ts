import { z } from "zod";
import { createApiSuccessSchema } from "./api.js";

export const HealthDataSchema = z.object({
  service: z.literal("cairn-server"),
  status: z.literal("ok")
});

export const HealthResponseSchema = createApiSuccessSchema(HealthDataSchema);

export type HealthData = z.infer<typeof HealthDataSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
