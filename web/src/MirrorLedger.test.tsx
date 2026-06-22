import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MirrorLedgerData, MirrorPatternsData } from "@cairn/shared";
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

const EMPTY_PATTERNS: MirrorPatternsData = {
  range: { from: "2026-05-22", to: "2026-06-21" },
  totals: { annotations: 0, done: 0, moved: 0, cancelled: 0, late: 0, slipCount: 0 },
  weekday: [],
  type: [],
  thread: [],
  sampleStatus: "low_sample"
};

const LIVE_PATTERNS: MirrorPatternsData = {
  range: { from: "2026-05-22", to: "2026-06-21" },
  totals: { annotations: 3, done: 1, moved: 2, cancelled: 0, late: 0, slipCount: 2 },
  weekday: [
    {
      key: "monday",
      label: "월요일",
      total: 3,
      outcomes: { done: 1, moved: 2, cancelled: 0, late: 0 },
      slipCount: 2,
      slipRatio: 0.667,
      sampleStatus: "ok"
    }
  ],
  type: [
    {
      key: "meet",
      label: "meet",
      total: 3,
      outcomes: { done: 1, moved: 2, cancelled: 0, late: 0 },
      slipCount: 2,
      slipRatio: 0.667,
      sampleStatus: "ok"
    }
  ],
  thread: [
    {
      key: "thread:1",
      thread: { id: 1, name: "프로젝트" },
      label: "프로젝트",
      total: 3,
      outcomes: { done: 1, moved: 2, cancelled: 0, late: 0 },
      slipCount: 2,
      slipRatio: 0.667,
      sampleStatus: "ok"
    }
  ],
  sampleStatus: "ok"
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

function stubFetch(ledgerData: MirrorLedgerData, patternsData: MirrorPatternsData = EMPTY_PATTERNS) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/mirror/patterns")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: patternsData }) });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: ledgerData }) });
    })
  );
}

describe("MirrorLedger — quiet state", () => {
  it("renders quiet copy when there are no annotations at all", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS);
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

  it("renders pattern section and ledger entries", async () => {
    stubFetch(liveData, LIVE_PATTERNS);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-patterns")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mirror-summary")).toBeInTheDocument();
    expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    expect(screen.getByText("팀 회의")).toBeInTheDocument();
  });

  it("shows weekday bucket copy in patterns section", async () => {
    stubFetch(liveData, LIVE_PATTERNS);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-patterns")).toBeInTheDocument();
    });
    expect(screen.getByText(/월요일 기록 3건 중 이동\/취소\/지각 2건/)).toBeInTheDocument();
  });

  it("does not show ledger low-sample copy when sampleStatus is ok", async () => {
    stubFetch(liveData, LIVE_PATTERNS);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mirror-low-sample")).not.toBeInTheDocument();
  });

  it("avoids prescriptive/moralizing copy", async () => {
    stubFetch(liveData, LIVE_PATTERNS);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-summary")).toBeInTheDocument();
    });
    expect(screen.queryByText(/줄여|고쳐|해야|하지 마/)).not.toBeInTheDocument();
  });

  it("shows ledger low-sample copy when ledger sampleStatus is low_sample", async () => {
    const lowData = ledger({
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
    });
    stubFetch(lowData, LIVE_PATTERNS);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-low-sample")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mirror-low-sample")).toHaveTextContent("표본이 적어 패턴으로 보긴 이르다");
  });

  it("shows patterns-level low-sample when patterns sampleStatus is low_sample", async () => {
    const lowPatterns: MirrorPatternsData = {
      ...LIVE_PATTERNS,
      sampleStatus: "low_sample"
    };
    stubFetch(liveData, lowPatterns);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("patterns-low-sample")).toBeInTheDocument();
    });
  });
});

describe("MirrorLedger — error states", () => {
  it("shows a generic error with retry on api failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { message: "boom" } }) }))
    );
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
