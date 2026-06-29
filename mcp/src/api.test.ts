import { describe, expect, it } from "vitest";
import { buildApiUrl, requestCairnApi, type FetchLike } from "./api.js";

describe("buildApiUrl", () => {
  it("keeps requests inside the Cairn API origin", () => {
    const url = buildApiUrl("http://127.0.0.1:3100", "/api/today", {
      date: "2026-06-29",
      limit: 3,
      skip: null
    });

    expect(url.toString()).toBe("http://127.0.0.1:3100/api/today?date=2026-06-29&limit=3");
  });

  it("rejects non-Cairn paths", () => {
    expect(() => buildApiUrl("http://127.0.0.1:3100", "https://example.com/api/today")).toThrow(/path must/);
    expect(() => buildApiUrl("http://127.0.0.1:3100", "/admin")).toThrow(/path must/);
  });
});

describe("requestCairnApi", () => {
  it("sends JSON body and returns parsed response", async () => {
    let capturedUrl = "";
    const capturedInits: RequestInit[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      capturedUrl = url.toString();
      capturedInits.push(init);
      return new Response(JSON.stringify({ ok: true, data: { id: 1 } }), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" }
      });
    };

    const response = await requestCairnApi(
      { baseUrl: "http://127.0.0.1:3100", fetchImpl },
      { method: "POST", path: "/api/tasks", body: { title: "test" } }
    );

    expect(capturedUrl).toBe("http://127.0.0.1:3100/api/tasks");
    const capturedInit = capturedInits[0];
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe(JSON.stringify({ title: "test" }));
    expect(response).toEqual({
      ok: true,
      status: 201,
      statusText: "Created",
      data: { ok: true, data: { id: 1 } }
    });
  });
});
