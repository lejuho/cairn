import { describe, expect, it } from "vitest";
import { createLlmGateway } from "./gateway.js";

describe("LLM gateway", () => {
  it("posts OpenAI-compatible requests to /v1/chat/completions", async () => {
    const seen = {
      url: "",
      mock: false
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.url = String(input);
      seen.mock = JSON.parse(String(init?.body)).mock === true;
      return Response.json({
        id: "chatcmpl_mock",
        object: "chat.completion",
        created: 1,
        model: "grok-mock",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "mock ok"
            },
            finish_reason: "stop"
          }
        ]
      });
    };

    const gateway = createLlmGateway({
      baseUrl: "http://proxy.test:8000",
      allowMock: true,
      fetchImpl,
      retryCount: 0,
      timeoutMs: 1_000
    });
    const result = await gateway.completeChat({
      model: "grok-mock",
      mock: true,
      messages: [{ role: "user", content: "hello" }]
    });

    expect(seen.url).toBe("http://proxy.test:8000/v1/chat/completions");
    expect(seen.mock).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.choices[0]?.message.content).toBe("mock ok");
    }
  });

  it("returns unavailable when the proxy is down", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("connection refused");
    };
    const gateway = createLlmGateway({
      baseUrl: "http://127.0.0.1:1",
      fetchImpl,
      retryCount: 0,
      timeoutMs: 100
    });
    const result = await gateway.completeChat({
      model: "grok-mock",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "LLM proxy is unavailable"
      }
    });
  });

  it("rejects mock mode outside tests", async () => {
    const gateway = createLlmGateway({
      allowMock: false
    });
    const result = await gateway.completeChat({
      model: "grok-mock",
      mock: true,
      messages: [{ role: "user", content: "hello" }]
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("mock_not_allowed");
    }
  });
});
