import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MirrorAutomationNeedsData, MirrorEnergyTrendData, MirrorLedgerData, MirrorPatternsData } from "@cairn/shared";
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

const EMPTY_ENERGY: MirrorEnergyTrendData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  summary: {
    days: 31,
    scheduledDays: 0,
    deficitDays: 0,
    averageDailyLoadUnits: 0,
    averageScheduledLoadUnits: 0,
    peakLoadUnits: 0,
    budgetUnits: 8,
    sampleStatus: "low_sample"
  },
  days: [],
  sampleStatus: "low_sample"
};

const LIVE_ENERGY: MirrorEnergyTrendData = {
  range: { from: "2026-06-20", to: "2026-06-22" },
  summary: {
    days: 3,
    scheduledDays: 3,
    deficitDays: 1,
    averageDailyLoadUnits: 3,
    averageScheduledLoadUnits: 3,
    peakLoadUnits: 5,
    budgetUnits: 8,
    sampleStatus: "ok"
  },
  days: [
    { date: "2026-06-22", eventCount: 2, loadUnits: 5, budgetUnits: 8, remainingUnits: 3, deficit: false, continuousExceeded: false },
    { date: "2026-06-21", eventCount: 1, loadUnits: 9, budgetUnits: 8, remainingUnits: -1, deficit: true, continuousExceeded: false },
    { date: "2026-06-20", eventCount: 1, loadUnits: 1, budgetUnits: 8, remainingUnits: 7, deficit: false, continuousExceeded: false }
  ],
  sampleStatus: "ok"
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

const EMPTY_AUTOMATION: MirrorAutomationNeedsData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  items: [],
  sampleStatus: "ok"
};

const WATCH_AUTOMATION: MirrorAutomationNeedsData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  items: [
    {
      watcherId: 10,
      label: "비자 공고",
      category: null,
      sourceStability: "unknown",
      manualLogCount: 5,
      signalSeenCount: 3,
      missedSignalCount: 2,
      missRate: 0.4,
      level: "watch",
      reasonCodes: ["miss_seen_below_threshold"],
      reasons: ["미스 2회 발생, 아직 임계치 미달"]
    }
  ],
  sampleStatus: "ok"
};

function stubFetch(
  ledgerData: MirrorLedgerData,
  patternsData: MirrorPatternsData = EMPTY_PATTERNS,
  energyData: MirrorEnergyTrendData = EMPTY_ENERGY,
  automationData: MirrorAutomationNeedsData = EMPTY_AUTOMATION
) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/mirror/patterns")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: patternsData }) });
      }
      if (url.includes("/api/mirror/energy-trends")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: energyData }) });
      }
      if (url.includes("/api/mirror/automation-needs")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: automationData }) });
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

  it("stays quiet when automation-needs is empty", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, EMPTY_AUTOMATION);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-quiet")).toBeInTheDocument());
    expect(screen.queryByTestId("mirror-automation-needs")).not.toBeInTheDocument();
  });

  it("stays quiet when all automation items are level=quiet", async () => {
    const allQuiet: MirrorAutomationNeedsData = {
      ...WATCH_AUTOMATION,
      items: [{ ...WATCH_AUTOMATION.items[0]!, level: "quiet", reasonCodes: ["no_misses"], reasons: ["미스 없음"] }]
    };
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, allQuiet);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-quiet")).toBeInTheDocument());
    expect(screen.queryByTestId("mirror-automation-needs")).not.toBeInTheDocument();
  });

  it("mirror-quiet does NOT mask automation-needs — enters live when watch item present", async () => {
    // Ledger/energy/patterns empty but automation has a watch-level item
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, WATCH_AUTOMATION);
    render(<MirrorLedger />);
    // Actionable automation → isEmpty=false → live state; automation-needs visible
    await waitFor(() => expect(screen.getByTestId("mirror-automation-needs")).toBeInTheDocument());
    expect(screen.getByText("비자 공고")).toBeInTheDocument();
    // No quiet masking
    expect(screen.queryByTestId("mirror-quiet")).not.toBeInTheDocument();
  });
});

describe("MirrorLedger — automation-needs reasons and /watch link", () => {
  it("renders human-readable reasons in automation card", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, WATCH_AUTOMATION);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-automation-needs")).toBeInTheDocument());
    expect(screen.getByText("미스 2회 발생, 아직 임계치 미달")).toBeInTheDocument();
  });

  it("renders /watch link in automation-needs section", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, WATCH_AUTOMATION);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-automation-needs")).toBeInTheDocument());
    const watchLink = screen.getByRole("link", { name: "여백 →" });
    expect(watchLink).toBeInTheDocument();
    expect(watchLink).toHaveAttribute("href", "/watch");
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
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-patterns")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mirror-summary")).toBeInTheDocument();
    expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    expect(screen.getByText("팀 회의")).toBeInTheDocument();
  });

  it("shows weekday bucket copy in patterns section", async () => {
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-patterns")).toBeInTheDocument();
    });
    expect(screen.getByText(/월요일 기록 3건 중 이동\/취소\/지각 2건/)).toBeInTheDocument();
  });

  it("does not show ledger low-sample copy when sampleStatus is ok", async () => {
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mirror-low-sample")).not.toBeInTheDocument();
  });

  it("avoids prescriptive/moralizing copy", async () => {
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
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
    stubFetch(lowData, LIVE_PATTERNS, LIVE_ENERGY);
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
    stubFetch(liveData, lowPatterns, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("patterns-low-sample")).toBeInTheDocument();
    });
  });

  it("renders energy trend section with summary chips", async () => {
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument();
    });
    expect(screen.getByText(/예산 초과 1일/)).toBeInTheDocument();
    expect(screen.getByText(/예산 8시간/)).toBeInTheDocument();
    expect(screen.getByText(/일정 있는 날 3일/)).toBeInTheDocument();
  });

  it("marks deficit day rows with testid", async () => {
    stubFetch(liveData, LIVE_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument();
    });
    expect(screen.getByTestId("energy-deficit-2026-06-21")).toBeInTheDocument();
  });

  it("shows energy low-sample note when scheduledDays < 3", async () => {
    const lowEnergy: MirrorEnergyTrendData = {
      ...EMPTY_ENERGY,
      summary: {
        ...EMPTY_ENERGY.summary,
        scheduledDays: 2,
        days: 7
      },
      days: [
        { date: "2026-06-21", eventCount: 1, loadUnits: 2, budgetUnits: 8, remainingUnits: 6, deficit: false, continuousExceeded: false },
        { date: "2026-06-22", eventCount: 1, loadUnits: 1, budgetUnits: 8, remainingUnits: 7, deficit: false, continuousExceeded: false }
      ],
      sampleStatus: "low_sample"
    };
    stubFetch(liveData, LIVE_PATTERNS, lowEnergy);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("energy-low-sample")).toBeInTheDocument();
    });
  });

  it("does not render energy section when scheduledDays is 0", async () => {
    stubFetch(liveData, LIVE_PATTERNS, EMPTY_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-entries")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mirror-energy-trend")).not.toBeInTheDocument();
  });

  it("enters live state when only energy has scheduledDays > 0", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, LIVE_ENERGY);
    render(<MirrorLedger />);
    await waitFor(() => {
      expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("mirror-quiet")).not.toBeInTheDocument();
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
