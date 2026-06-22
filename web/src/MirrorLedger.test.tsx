import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MirrorLedgerData } from "@cairn/shared";
import { MirrorLedger } from "./MirrorLedger.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_SUMMARY = {
  totalChanges: 0,
  movedCount: 0,
  cancelledCount: 0,
  freeCount: 0,
  paidCount: 0,
  moneyTotal: 0,
  socialTotal: 0,
  effortBreakdown: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 }
};

function ledger(over: Partial<MirrorLedgerData>): MirrorLedgerData {
  return {
    range: { from: "2026-05-22", to: "2026-06-21" },
    summary: BASE_SUMMARY,
    entries: [],
    sampleStatus: "low_sample",
    ...over
  };
}

function stubLedger(data: MirrorLedgerData) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: true, data }) })));
}

describe("MirrorLedger — quiet state", () => {
  it("renders quiet copy when there are no entries", async () => {
    stubLedger(ledger({ entries: [] }));
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-quiet")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "아직 기록된 이동/취소 원장이 없어" })).toBeInTheDocument();
  });
});

describe("MirrorLedger — live state", () => {
  const liveData = ledger({
    summary: {
      ...BASE_SUMMARY,
      totalChanges: 3,
      movedCount: 2,
      cancelledCount: 1,
      freeCount: 1,
      paidCount: 2,
      moneyTotal: 12000,
      socialTotal: 2,
      effortBreakdown: { none: 1, low: 0, medium: 1, high: 1, unknown: 0 }
    },
    sampleStatus: "ok",
    entries: [
      {
        annotationId: 42,
        eventId: 10,
        eventTitle: "팀 회의",
        thread: { id: 1, name: "프로젝트" },
        outcome: "moved",
        reasonText: "겹쳤어",
        reasonTags: ["conflict_resolution"],
        loggedAt: "2026-06-21 09:00:00",
        eventStart: "2026-06-21T10:00:00+09:00",
        cost: { money: 12000, social: 2, effort: "medium", window: "same_day", hasAnyCost: true }
      }
    ]
  });

  it("renders summary and entries", async () => {
    stubLedger(liveData);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-summary")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    expect(screen.getByText("팀 회의")).toBeInTheDocument();
    expect(screen.getByText("이동")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "프로젝트" })).toHaveAttribute("href", "/threads/1");
  });

  it("does not show low-sample copy when sampleStatus is ok", async () => {
    stubLedger(liveData);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mirror-low-sample")).not.toBeInTheDocument();
  });

  it("avoids prescriptive/moralizing copy", async () => {
    stubLedger(liveData);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-summary")).toBeInTheDocument();
    });
    expect(screen.queryByText(/줄여|고쳐|해야|하지 마/)).not.toBeInTheDocument();
  });

  it("shows low-sample copy when sampleStatus is low_sample", async () => {
    stubLedger(ledger({
      summary: { ...BASE_SUMMARY, totalChanges: 1, movedCount: 1, freeCount: 1, effortBreakdown: { none: 1, low: 0, medium: 0, high: 0, unknown: 0 } },
      sampleStatus: "low_sample",
      entries: [
        {
          annotationId: 1,
          eventId: 5,
          eventTitle: "산책",
          thread: null,
          outcome: "cancelled",
          reasonText: null,
          reasonTags: [],
          loggedAt: "2026-06-20 08:00:00",
          eventStart: null,
          cost: { money: 0, social: 0, effort: "none", window: null, hasAnyCost: false }
        }
      ]
    }));
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-low-sample")).toBeInTheDocument();
    });
    expect(screen.getByText("표본이 적어 패턴으로 보긴 이르다")).toBeInTheDocument();
  });
});

describe("MirrorLedger — error states", () => {
  it("shows a generic error with retry on api failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "boom" } }) })));
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "불러오지 못했어" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it("shows the access-session recovery on access error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "로그인이 필요해" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "새로 고침" })).toBeInTheDocument();
  });
});
