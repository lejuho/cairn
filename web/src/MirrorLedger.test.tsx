import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MirrorAutomationNeedsData, MirrorDiaryData, MirrorEnergyTrendData, MirrorLedgerData, MirrorPatternsData, MirrorTransitionFrictionData } from "@cairn/shared";
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

const EMPTY_FRICTION: MirrorTransitionFrictionData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  summary: { days: 31, activeDays: 0, totalTransitionPairs: 0, lowTransitionPairs: 0, highTransitionPairs: 0, unknownTransitionPairs: 0, lowSampleDays: 0, sampleStatus: "low_sample" },
  days: []
};

const LIVE_FRICTION: MirrorTransitionFrictionData = {
  range: { from: "2026-06-20", to: "2026-06-22" },
  summary: { days: 3, activeDays: 1, totalTransitionPairs: 2, lowTransitionPairs: 0, highTransitionPairs: 1, unknownTransitionPairs: 1, lowSampleDays: 0, sampleStatus: "ok" },
  days: [
    {
      date: "2026-06-20", eventCount: 3, transitionPairs: 2,
      sameThreadPairs: 0, contextPairs: 0, unrelatedPairs: 1, missingThreadPairs: 1,
      lowTransitionPairs: 0, highTransitionPairs: 1, unknownTransitionPairs: 1,
      outcomes: { done: 1, moved: 1, cancelled: 0, late: 0 },
      energy: { entryCount: 1, averageEnergyAtTime: 3 },
      sampleStatus: "ok", reasonCodes: ["friction_high_present", "friction_unknown_present"]
    }
  ]
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

const EMPTY_DIARY: MirrorDiaryData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  days: [],
  sampleStatus: "low_sample"
};

const DIARY_WITH_ENTRY: MirrorDiaryData = {
  range: { from: "2026-05-23", to: "2026-06-22" },
  days: [
    {
      date: "2026-06-21",
      headline: "회의 장소 변경",
      entries: [
        {
          annotationId: 1,
          eventId: 10,
          eventTitle: "팀 회의",
          eventStart: "2026-06-21T10:00:00+09:00",
          thread: { id: 1, name: "프로젝트" },
          outcome: "moved",
          reasonText: "회의 장소 변경",
          reasonTags: [],
          loggedAt: "2026-06-21 09:00:00",
          depth: "semi_auto",
          contextLabel: "팀 회의 / 이동"
        }
      ]
    }
  ],
  sampleStatus: "ok"
};

function stubFetch(
  ledgerData: MirrorLedgerData,
  patternsData: MirrorPatternsData = EMPTY_PATTERNS,
  energyData: MirrorEnergyTrendData = EMPTY_ENERGY,
  automationData: MirrorAutomationNeedsData = EMPTY_AUTOMATION,
  diaryData: MirrorDiaryData = EMPTY_DIARY,
  frictionData: MirrorTransitionFrictionData = EMPTY_FRICTION
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
      if (url.includes("/api/mirror/diary")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: diaryData }) });
      }
      if (url.includes("/api/mirror/transition-friction")) {
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: frictionData }) });
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

describe("MirrorLedger — diary section", () => {
  it("renders diary entry with event title, outcome, reasonText, depth", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, WATCH_AUTOMATION, DIARY_WITH_ENTRY);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-diary")).toBeInTheDocument());
    expect(screen.getByText("팀 회의")).toBeInTheDocument();
    expect(screen.getByText("회의 장소 변경")).toBeInTheDocument();
    expect(screen.getByText("직접 기록")).toBeInTheDocument();
    expect(screen.getByText("이동")).toBeInTheDocument();
  });

  it("diary-only data enters live state, not quiet masking", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, EMPTY_AUTOMATION, DIARY_WITH_ENTRY);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-diary")).toBeInTheDocument());
    expect(screen.queryByTestId("mirror-quiet")).not.toBeInTheDocument();
  });

  it("diary renders thread link when entry has thread", async () => {
    stubFetch(ledger({ entries: [] }), EMPTY_PATTERNS, EMPTY_ENERGY, WATCH_AUTOMATION, DIARY_WITH_ENTRY);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-diary")).toBeInTheDocument());
    const threadLink = screen.getByRole("link", { name: "프로젝트" });
    expect(threadLink).toHaveAttribute("href", "/threads/1");
  });

  it("diary fetch failure does not fail the whole Mirror screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/mirror/diary")) {
          return Promise.reject(new Error("diary network fail"));
        }
        if (url.includes("/api/mirror/patterns")) {
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: LIVE_PATTERNS }) });
        }
        if (url.includes("/api/mirror/energy-trends")) {
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: LIVE_ENERGY }) });
        }
        if (url.includes("/api/mirror/automation-needs")) {
          return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: EMPTY_AUTOMATION }) });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true, data: ledger({ entries: [] }) }) });
      })
    );
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument());
    expect(screen.queryByTestId("mirror-diary")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "불러오지 못했어" })).not.toBeInTheDocument();
  });

  it("existing ledger/pattern/energy sections still render alongside diary", async () => {
    const liveLedger = ledger({
      summary: { ...BASE_SUMMARY, totalChanges: 1, movedCount: 1, freeCount: 1, effortBreakdown: { none: 1, low: 0, medium: 0, high: 0, unknown: 0 } },
      sampleStatus: "ok",
      entries: [
        {
          annotationId: 99,
          eventId: 5,
          eventTitle: "점심 약속",
          thread: null,
          outcome: "moved",
          reasonText: null,
          reasonTags: [],
          loggedAt: "2026-06-21 12:00:00",
          eventStart: null,
          cost: { money: 0, social: 0, effort: "none", window: null, hasAnyCost: false }
        }
      ]
    });
    stubFetch(liveLedger, LIVE_PATTERNS, LIVE_ENERGY, EMPTY_AUTOMATION, DIARY_WITH_ENTRY);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-entries")).toBeInTheDocument());
    expect(screen.getByTestId("mirror-diary")).toBeInTheDocument();
    expect(screen.getByTestId("mirror-patterns")).toBeInTheDocument();
    expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument();
  });
});

describe("MirrorLedger — transition friction section (FR-MIR-09)", () => {
  it("renders summary chips and a day row with descriptive (not prescriptive) labels", async () => {
    stubFetch(ledger({}), EMPTY_PATTERNS, EMPTY_ENERGY, EMPTY_AUTOMATION, EMPTY_DIARY, LIVE_FRICTION);
    render(<MirrorLedger />);
    const section = await screen.findByTestId("mirror-transition-friction");
    expect(section).toHaveTextContent("전환 마찰");
    expect(section).toHaveTextContent("전환 2회");
    expect(section).toHaveTextContent("높은 전환 1회");
    expect(section).toHaveTextContent("불확실 1회");
    // day row evidence
    const row = screen.getByTestId("friction-day-2026-06-20");
    expect(row).toHaveTextContent("이동·취소·지연 1");
    expect(row).toHaveTextContent("평균 에너지 3");
    expect(screen.getByTestId("friction-high-2026-06-20")).toBeInTheDocument();
    expect(screen.getByTestId("friction-unknown-2026-06-20")).toBeInTheDocument();
    // no imperative recommendation / apply control
    expect(section).not.toHaveTextContent(/추천|권장|적용|조정해/);
    expect(screen.queryByRole("button", { name: /적용|조정|순서/ })).not.toBeInTheDocument();
  });

  it("shows the low-sample note when sampleStatus is low_sample", async () => {
    const lowSample = { ...LIVE_FRICTION, summary: { ...LIVE_FRICTION.summary, sampleStatus: "low_sample" as const } };
    stubFetch(ledger({}), EMPTY_PATTERNS, EMPTY_ENERGY, EMPTY_AUTOMATION, EMPTY_DIARY, lowSample);
    render(<MirrorLedger />);
    await screen.findByTestId("mirror-transition-friction");
    expect(screen.getByTestId("friction-low-sample")).toBeInTheDocument();
  });

  it("hides the section when there are no active days (page still live via other data)", async () => {
    // LIVE_ENERGY forces the live view; EMPTY_FRICTION must keep the section hidden.
    stubFetch(ledger({}), EMPTY_PATTERNS, LIVE_ENERGY, EMPTY_AUTOMATION, EMPTY_DIARY, EMPTY_FRICTION);
    render(<MirrorLedger />);
    await waitFor(() => expect(screen.getByTestId("mirror-energy-trend")).toBeInTheDocument());
    expect(screen.queryByTestId("mirror-transition-friction")).not.toBeInTheDocument();
  });
});
