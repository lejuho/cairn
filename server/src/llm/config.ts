const DEFAULT_LLM_MODEL = "grok-3-mini";

export function getLlmModel(): string {
  const configured = process.env.LLM_MODEL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_LLM_MODEL;
}
