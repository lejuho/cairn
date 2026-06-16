import { describe, expect, it } from "vitest";
import { buildServer } from "./app.js";

describe("GET /health", () => {
  it("returns the public health shape", async () => {
    const app = buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      data: {
        service: "cairn-server",
        status: "ok"
      }
    });
  });
});
