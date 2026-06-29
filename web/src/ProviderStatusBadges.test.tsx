import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderStatusBadges } from "./ProviderStatusBadges.js";
import { AppNav } from "./AppNav.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ROW = (id: string, label: string, state: string, code: string, message: string) => ({
  id, label, state, code, checkedAt: "2026-06-29T00:00:00.000Z", ttlSeconds: 300, message
});
const okRes = (rows: unknown[]) => Promise.resolve({
  ok: true, status: 200, redirected: false, url: "", headers: new Headers({ "content-type": "application/json" }),
  json: () => Promise.resolve({ ok: true, data: { providers: rows } })
});

describe("ProviderStatusBadges (cycle-82)", () => {
  it("renders connected + disabled badges with accessible labels", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okRes([ROW("google", "Google", "connected", "ok", "연결됨"), ROW("naver", "Naver", "disabled", "disabled", "비활성")])));
    render(<ProviderStatusBadges />);
    expect(await screen.findByTestId("provider-status-google")).toHaveTextContent("Google 연결됨");
    expect(screen.getByLabelText("Google 연결됨")).toBeInTheDocument();
    expect(screen.getByTestId("provider-status-naver")).toHaveTextContent("Naver 비활성");
    expect(screen.getByTestId("provider-status-naver")).toHaveAttribute("data-state", "disabled");
  });

  it("renders a degraded provider as '연결 안 됨'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okRes([ROW("google", "Google", "degraded", "rate_limited", "요청 한도 초과"), ROW("naver", "Naver", "connected", "ok", "연결됨")])));
    render(<ProviderStatusBadges />);
    expect(await screen.findByTestId("provider-status-google")).toHaveTextContent("Google 연결 안 됨");
    expect(screen.getByTestId("provider-status-google")).toHaveAttribute("data-state", "degraded");
  });

  it("stays quiet (no badges) on initial fetch failure and keeps AppNav links usable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));
    render(<AppNav path="/today" />);
    expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("provider-status")).not.toBeInTheDocument();
  });

  it("preserves last known rows and marks them stale when a later poll fails", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(() => { call += 1; return call === 1 ? okRes([ROW("google", "Google", "connected", "ok", "연결됨")]) : Promise.reject(new Error("network")); }));
    render(<ProviderStatusBadges />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); }); // flush mount fetch
    expect(screen.getByTestId("provider-status-google")).toHaveTextContent("Google 연결됨");
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); }); // poll → fails
    expect(screen.getByTestId("provider-status-google")).toHaveTextContent("확인 중"); // stale marker
    expect(screen.getByTestId("provider-status-google")).toHaveTextContent("Google 연결됨"); // last known preserved
    vi.useRealTimers();
  });

  it("clears the poll interval on unmount", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okRes([ROW("google", "Google", "connected", "ok", "연결됨")])));
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<ProviderStatusBadges />);
    await waitFor(() => expect(screen.getByTestId("provider-status-google")).toBeInTheDocument());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
