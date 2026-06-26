import { describe, expect, it } from "vitest";
import type { ChatCompletionRequest } from "@cairn/shared";
import type { LlmGateway, LlmGatewayResult } from "./gateway.js";
import { parseThreadDraft } from "./threadDraftParser.js";

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

const VALID_DRAFT = {
  thread: { name: "파리 여행", kind: "travel", goal: null, deadline: null },
  events: [{ tempId: "e1", title: "항공권 예약", type: null, start: null, end: null, location: null, mode: null }],
  tasks: [], links: [], warnings: []
};

describe("parseThreadDraft (cycle-51)", () => {
  it("returns the parsed draft on valid JSON", async () => {
    const r = await parseThreadDraft(contentGateway(JSON.stringify(VALID_DRAFT)), "여행 계획", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.error).toBeNull();
    expect(r.data?.thread.name).toBe("파리 여행");
  });

  it("returns invalid_json on a non-JSON response", async () => {
    const r = await parseThreadDraft(contentGateway("sorry, here is your plan:"), "x", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.data).toBeNull();
    expect(r.error).toBe("invalid_json");
  });

  it("returns invalid_schema on schema mismatch (unknown enum)", async () => {
    const bad = { ...VALID_DRAFT, events: [{ ...VALID_DRAFT.events[0], mode: "hybrid" }] };
    const r = await parseThreadDraft(contentGateway(JSON.stringify(bad)), "x", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.error).toBe("invalid_schema");
  });

  it("returns invalid_schema when the LLM injects firmness/source/status", async () => {
    const bad = { ...VALID_DRAFT, events: [{ ...VALID_DRAFT.events[0], status: "confirmed" }] };
    const r = await parseThreadDraft(contentGateway(JSON.stringify(bad)), "x", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.error).toBe("invalid_schema");
  });

  it("propagates the gateway error code on failure", async () => {
    const r = await parseThreadDraft(gateway(() => ({ ok: false, error: { code: "unavailable", message: "down" } })), "x", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.error).toBe("unavailable");
  });

  it("prompt forbids fabricated unknowns and out-of-schema fields", async () => {
    let captured = "";
    const r = await parseThreadDraft(gateway((req) => {
      captured = req.messages.find((m) => m.role === "system")?.content ?? "";
      return { ok: true, data: { id: "t", object: "chat.completion" as const, created: 0, model: "grok-3-mini", choices: [{ index: 0, message: { role: "assistant" as const, content: JSON.stringify(VALID_DRAFT) }, finish_reason: "stop" }] } };
    }), "x", "2026-06-20T09:00:00+09:00", "Asia/Seoul");
    expect(r.error).toBeNull();
    expect(captured).toMatch(/null/);
    expect(captured).toMatch(/TBD|placeholder|guessed/i);
    expect(captured).toMatch(/firmness|source|status/);
  });
});
