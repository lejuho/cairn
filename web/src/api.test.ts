import { describe, it, expect, vi, afterEach } from "vitest";
import { apiJson } from "./api.js";

afterEach(() => { vi.restoreAllMocks(); });

function makeResponse(opts: {
  status?: number;
  contentType?: string;
  body?: string;
  redirected?: boolean;
  url?: string;
}): Response {
  const status = opts.status ?? 200;
  const contentType = opts.contentType ?? "application/json";
  const bodyText = opts.body ?? "";
  return {
    status,
    redirected: opts.redirected ?? false,
    url: opts.url ?? "",
    headers: { get: (key: string) => key === "content-type" ? contentType : null },
    json: () => Promise.resolve(JSON.parse(bodyText)),
    text: () => Promise.resolve(bodyText)
  } as unknown as Response;
}

describe("apiJson — success", () => {
  it("parses 200 JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ body: '{"ok":true}' })));
    const result = await apiJson<{ ok: boolean }>("/api/test");
    expect(result).toEqual({ ok: true });
  });
});

describe("apiJson — access_session_required", () => {
  it("throws access_session_required for 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ status: 401 })));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "access_session_required" });
  });

  it("throws access_session_required for 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse({ status: 403 })));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "access_session_required" });
  });

  it("throws access_session_required for redirected response to cloudflareaccess.com", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({ redirected: true, url: "https://cairn.cloudflareaccess.com/login" })
    ));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "access_session_required" });
  });

  it("throws access_session_required for HTML body with CF Access marker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({
        status: 200,
        contentType: "text/html",
        body: '<html><body>Please visit /cdn-cgi/access/login to continue</body></html>'
      })
    ));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "access_session_required" });
  });

  it("throws access_session_required when fetch is rejected (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "access_session_required" });
  });
});

describe("apiJson — generic errors", () => {
  it("throws api_error for HTML body without Access markers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeResponse({
        status: 500,
        contentType: "text/html",
        body: "<html><body>Internal Server Error</body></html>"
      })
    ));
    await expect(apiJson("/api/test")).rejects.toMatchObject({ kind: "api_error", status: 500 });
  });
});
