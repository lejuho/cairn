import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterSettings } from "./ParameterSettings.js";

const BASE_PARAMS = {
  energyBudget: 8,
  meetBufferMinutes: 15,
  deepBufferMinutes: 30,
  travelMargin: 1,
  maxContinuousMinutes: 600
};

const BASE_SETTINGS = {
  params: BASE_PARAMS,
  defaults: BASE_PARAMS,
  limits: {
    energyBudget:        { min: 1,   max: 16,  step: 0.5, unit: "h" },
    meetBufferMinutes:   { min: 0,   max: 120, step: 5,   unit: "min" },
    deepBufferMinutes:   { min: 0,   max: 180, step: 5,   unit: "min" },
    travelMargin:        { min: 0.5, max: 3,   step: 0.1, unit: "x" },
    maxContinuousMinutes:{ min: 60,  max: 960, step: 30,  unit: "min" }
  }
};

const PREVIEW = {
  date: "2026-06-29",
  now: "2026-06-29T09:00:00+09:00",
  params: { ...BASE_PARAMS, energyBudget: 10 },
  energy: { loadUnits: 2.5, budgetUnits: 10, remainingUnits: 7.5, deficit: false, confidence: "cold_start" },
  gaps: [],
  continuous: null,
  transitionCosts: [],
  sequenceEnergy: {
    workLoadUnits: 2.5,
    transitionLoadUnits: 0,
    totalLoadUnits: 2.5,
    budgetUnits: 10,
    remainingUnits: 7.5,
    deficit: false,
    unknownTransitionCount: 0,
    confidence: "cold_start",
    reasonCodes: ["sequence_work_only"]
  },
  sequenceOrder: { violations: [], softEdges: [], recommendedOrder: [], reasonCodes: [] }
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body
  } as Response;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ParameterSettings", () => {
  it("loads and renders all feasibility controls", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ ok: true, data: BASE_SETTINGS }))));

    render(<ParameterSettings />);

    expect(screen.getByTestId("params-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("params-live")).toBeInTheDocument());
    for (const label of ["에너지 예산", "미팅 버퍼", "집중 버퍼", "이동 여유", "최대 연속"]) {
      expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it("previews changed params and saves them explicitly", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/feasibility/day/preview")) {
        return Promise.resolve(jsonResponse({ ok: true, data: PREVIEW }));
      }
      if (url.includes("/api/feasibility/params") && init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true, data: BASE_SETTINGS }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ParameterSettings />);
    await waitFor(() => expect(screen.getByTestId("params-live")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/에너지 예산/), { target: { value: "10" } });

    await waitFor(() => expect(screen.getByText("2.5h / 10h")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "파라미터 저장" }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([url, init]) =>
        String(url).includes("/api/feasibility/params") && (init as RequestInit | undefined)?.method === "PUT"
      );
      expect(putCall).toBeDefined();
      const payload = JSON.parse((putCall![1] as RequestInit).body as string) as { energyBudget: number };
      expect(payload.energyBudget).toBe(10);
    });
    expect(screen.getByRole("status")).toHaveTextContent("저장됐어");
  });

  it("shows a recoverable error state when params fail to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ ok: false, error: { message: "서버 오류" } }))));

    render(<ParameterSettings />);

    await waitFor(() => expect(screen.getByTestId("params-error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
