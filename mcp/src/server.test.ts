import { describe, expect, it } from "vitest";
import { CairnMcpServer } from "./server.js";
import type { FetchLike } from "./api.js";
import { isJsonObject } from "./json.js";

describe("CairnMcpServer", () => {
  it("initializes and lists tools", async () => {
    const server = new CairnMcpServer({ baseUrl: "http://127.0.0.1:3100", fetchImpl: okFetch({ ok: true }) });

    const init = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "test-version" }
    }));
    const list = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }));

    expect(init?.id).toBe(1);
    expect(init && "result" in init && isJsonObject(init.result) ? init.result.protocolVersion : null).toBe("test-version");
    expect(list?.id).toBe(2);
    expect(list && "result" in list && isJsonObject(list.result) && Array.isArray(list.result.tools)).toBe(true);
  });

  it("calls a Cairn tool through fetch", async () => {
    let capturedUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url.toString();
      return jsonResponse({ ok: true, data: { date: "2026-06-29" } });
    };
    const server = new CairnMcpServer({ baseUrl: "http://127.0.0.1:3100", fetchImpl });

    const result = await server.handleLine(JSON.stringify({
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name: "cairn_today_get",
        arguments: { date: "2026-06-29" }
      }
    }));

    expect(capturedUrl).toBe("http://127.0.0.1:3100/api/today?date=2026-06-29");
    expect(result?.id).toBe("call-1");
    expect(result && "result" in result && isJsonObject(result.result) && Array.isArray(result.result.content)).toBe(true);
  });
});

function okFetch(body: unknown): FetchLike {
  return async () => jsonResponse(body);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: "OK",
    headers: { "Content-Type": "application/json" }
  });
}
