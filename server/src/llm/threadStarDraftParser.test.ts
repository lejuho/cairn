import { describe, expect, it } from "vitest";
import type { ChatCompletionRequest } from "@cairn/shared";
import type { LlmGateway, LlmGatewayResult } from "./gateway.js";
import { parseThreadStarDraft, type StarDraftPromptInput } from "./threadStarDraftParser.js";

function gateway(handler: (req: ChatCompletionRequest) => LlmGatewayResult): LlmGateway {
  return {
    chatCompletionsUrl: new URL("http://localhost:8000/v1/chat/completions"),
    async completeChat(req) { return handler(req); }
  };
}
function contentGateway(content: string): LlmGateway {
  return gateway(() => ({
    ok: true,
    data: { id: "t", object: "chat.completion" as const, created: 0, model: "grok-3-mini",
      choices: [{ index: 0, message: { role: "assistant" as const, content }, finish_reason: "stop" }] }
  }));
}

const INPUT: StarDraftPromptInput = {
  thread: { name: "파리 여행", kind: "trip", goal: "6월 파리", deadline: null },
  nodes: [{ title: "항공권 예약", status: "done", kind: "event" }],
  annotations: [{ outcome: "done", reasonText: "예약 완료" }],
  settlementSummary: "paid: 0 events; completed 1/1; avoided-cost money is UNAVAILABLE"
};
const NARRATIVE = { situation: "s", task: "t", action: "a", result: "r", skills: ["계획"] };

describe("parseThreadStarDraft (cycle-55)", () => {
  it("parses valid narrative JSON", async () => {
    const r = await parseThreadStarDraft(contentGateway(JSON.stringify(NARRATIVE)), INPUT);
    expect(r.error).toBeNull();
    expect(r.data?.situation).toBe("s");
  });
  it("returns invalid_json on non-JSON content", async () => {
    const r = await parseThreadStarDraft(contentGateway("here is your STAR draft:"), INPUT);
    expect(r.data).toBeNull();
    expect(r.error).toBe("invalid_json");
  });
  it("returns invalid_schema on schema-invalid output (empty field / >8 skills)", async () => {
    expect((await parseThreadStarDraft(contentGateway(JSON.stringify({ ...NARRATIVE, situation: "" })), INPUT)).error).toBe("invalid_schema");
    expect((await parseThreadStarDraft(contentGateway(JSON.stringify({ ...NARRATIVE, skills: Array(9).fill("x") })), INPUT)).error).toBe("invalid_schema");
  });
  it("rejects model-injected confidence/reasonCodes (narrative is strict)", async () => {
    const r = await parseThreadStarDraft(contentGateway(JSON.stringify({ ...NARRATIVE, confidence: "draft", reasonCodes: [] })), INPUT);
    expect(r.error).toBe("invalid_schema");
  });
  it("propagates gateway error codes", async () => {
    for (const code of ["unavailable", "rate_limited", "queue_full", "invalid_response"]) {
      const r = await parseThreadStarDraft(gateway(() => ({ ok: false, error: { code: code as never, message: "x" } })), INPUT);
      expect(r.error).toBe(code);
    }
  });
  it("includes the avoided-money-unavailable instruction in the prompt", async () => {
    let sys = "";
    await parseThreadStarDraft(gateway((req) => {
      sys = req.messages.find((m) => m.role === "system")?.content ?? "";
      return { ok: true, data: { id: "t", object: "chat.completion" as const, created: 0, model: "grok-3-mini", choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(NARRATIVE) }, finish_reason: "stop" }] } };
    }), INPUT);
    expect(sys).toMatch(/unavailable/i);
    expect(sys).toMatch(/do NOT|not state/i);
    expect(sys).toMatch(/confidence|reasonCodes/);
  });
});
