import { ThreadStarDraftNarrativeSchema, type ThreadStarDraftNarrative } from "@cairn/shared";
import type { LlmGateway } from "./gateway.js";
import { getLlmModel } from "./config.js";

// Single LLM boundary for STAR draft generation (cycle-55 FR-CV-01). The model
// authors narrative text ONLY — confidence and reasonCodes are forced by the
// service. The draft is grounded strictly in the supplied completed-thread
// evidence; the model must not invent facts or a monetary impact.
const SYSTEM_PROMPT = `You write a STAR (Situation, Task, Action, Result) reflection from a COMPLETED project's evidence.
Return ONLY a JSON object — no explanation, no markdown fences.

Schema:
{ "situation": string, "task": string, "action": string, "result": string, "skills": string[] }

Rules:
- Ground every sentence in the supplied evidence (goal, node titles, annotations, settlement). Do NOT invent facts.
- result: summarize the outcome using the settlement evidence. If avoided-cost money is unavailable, do NOT state any monetary amount or savings figure.
- skills: 0 to 8 concise skill phrases demonstrated, each non-empty.
- Keep each field a single concise paragraph; no markdown, no bullet symbols.
- Do NOT output confidence, reasonCodes, or any field outside the schema.`;

export type StarDraftPromptInput = {
  thread: { name: string; kind: string | null; goal: string | null; deadline: string | null };
  nodes: { title: string; status: string | null; kind: "event" | "task" }[];
  annotations: { outcome: string | null; reasonText: string | null }[];
  settlementSummary: string;
};

function buildUserPrompt(input: StarDraftPromptInput): string {
  const t = input.thread;
  const lines: string[] = [];
  lines.push(`Thread: ${t.name}`);
  lines.push(`Kind: ${t.kind ?? "(unknown)"}`);
  lines.push(`Goal: ${t.goal ?? "(none recorded)"}`);
  lines.push(`Deadline: ${t.deadline ?? "(none)"}`);
  lines.push("");
  lines.push("Direct nodes (title — kind — status):");
  for (const n of input.nodes) lines.push(`- ${n.title} — ${n.kind} — ${n.status ?? "?"}`);
  if (input.nodes.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push("Direct event notes:");
  for (const a of input.annotations) lines.push(`- ${a.outcome ?? "note"}: ${a.reasonText ?? ""}`.trim());
  if (input.annotations.length === 0) lines.push("- (none)");
  lines.push("");
  lines.push(`Settlement: ${input.settlementSummary}`);
  return lines.join("\n");
}

export type ParseThreadStarDraftResult =
  | { data: ThreadStarDraftNarrative; error: null }
  | { data: null; error: string };

export async function parseThreadStarDraft(
  gateway: LlmGateway,
  input: StarDraftPromptInput
): Promise<ParseThreadStarDraftResult> {
  const result = await gateway.completeChat({
    model: getLlmModel(),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) }
    ],
    temperature: 0
  });

  if (!result.ok) return { data: null, error: result.error.code };

  const raw = result.data.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: null, error: "invalid_json" };
  }

  const validated = ThreadStarDraftNarrativeSchema.safeParse(parsed);
  if (!validated.success) return { data: null, error: "invalid_schema" };
  return { data: validated.data, error: null };
}
