import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thread } from "./Thread.js";
import type { PromotionSuggestion, ThreadDetail, ThreadLinkView, ThreadResourceFocusData, ThreadRollup, ThreadSettlement, ThreadSummary, ThreadUnknownBlocker } from "@cairn/shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_THREAD = {
  id: 1,
  name: "프로젝트 알파",
  kind: "project",
  goal: "1분기 목표 달성",
  definitionOfDone: null,
  deadline: "2026-09-01",
  status: "active" as const,
  createdAt: "2026-06-17T00:00:00"
};

const BASE_EVENT = {
  id: 10,
  threadId: 1,
  title: "킥오프 미팅",
  start: "2099-06-20T10:00:00+09:00",
  end: "2099-06-20T11:00:00+09:00",
  type: null, location: null,
  mode: null,
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

const BASE_TASK = {
  id: 20, threadId: 1, title: "자료 준비",
  estMinutes: 30, due: null, context: null,
  status: "todo" as const, optional: 0, createdAt: null
};

const EMPTY_RELATIONS: ThreadDetail["relations"] = { incoming: [], outgoing: [] };

const EMPTY_SETTLEMENT_T: ThreadSettlement = {
  status: "not_ready",
  paidCost: { eventCount: 0, money: 0, social: 0, effort: { none: 0, low: 0, medium: 0, high: 0, unknown: 0 }, windowCount: 0 },
  avoidedMissing: { doneCount: 0, totalCount: 0, knownAvoidedCount: 0, unknownCostCount: 0, money: null, moneyStatus: "unavailable" },
  sampleStatus: "empty",
  reasonCodes: ["settlement_not_done"]
};

const EMPTY_ROLLUP: ThreadRollup = {
  direct: { progress: { done: 0, total: 0 }, energyHours: 0 },
  contains: { childCount: 0, descendantCount: 0, progress: { done: 0, total: 0 }, energyHours: 0, missingCost: null, missingCostStatus: "unavailable" },
  total: { progress: { done: 0, total: 0 }, energyHours: 0, missingCost: null, missingCostStatus: "unavailable" },
  children: [],
  warnings: []
};

const OUTGOING_LINK: ThreadLinkView = {
  id: 100,
  fromThread: { id: 1, name: "프로젝트 알파" },
  toThread: { id: 2, name: "하위 스레드" },
  kind: "contains",
  firmness: "hard",
  createdAt: "2026-06-21T00:00:00"
};

const INCOMING_LINK: ThreadLinkView = {
  id: 101,
  fromThread: { id: 3, name: "상위 스레드" },
  toThread: { id: 1, name: "프로젝트 알파" },
  kind: "contains",
  firmness: "hard",
  createdAt: "2026-06-21T00:00:00"
};

const SUMMARY_OTHER: ThreadSummary = {
  thread: { id: 2, name: "하위 스레드", kind: null, goal: null, definitionOfDone: null, deadline: null, status: "active", createdAt: null },
  eventCount: 0, taskCount: 0, doneCount: 0, totalCount: 0,
  relationCounts: { incoming: 0, outgoing: 0 }
};

function makeResponse(body: unknown, url = "/api/threads/1", status = 200) {
  return {
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    redirected: false,
    url,
    json: () => Promise.resolve(body)
  };
}

const EMPTY_FOCUS: ThreadResourceFocusData = { threadId: 1, resources: [] };

function mockFetch(
  detail: Omit<ThreadDetail, "relations" | "rollup" | "nodeLinks" | "unknownBlockers" | "settlement"> & Partial<Pick<ThreadDetail, "relations" | "rollup" | "nodeLinks" | "unknownBlockers" | "settlement">>,
  focus: ThreadResourceFocusData = EMPTY_FOCUS,
  suggestions: PromotionSuggestion[] = []
) {
  const data: ThreadDetail = { relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T, ...detail };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("promotion-suggestions")) {
        return Promise.resolve(makeResponse({ ok: true, data: { suggestions } }, url));
      }
      if (url.includes("resource-focus")) {
        return Promise.resolve(makeResponse({ ok: true, data: focus }, url));
      }
      return Promise.resolve(makeResponse({ ok: true, data }, url));
    })
  );
}

function mockFetchError(code = "NOT_FOUND") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) {
        return Promise.resolve(makeResponse({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }, url, 404));
      }
      return Promise.resolve(makeResponse({ ok: false, error: { code, message: "Thread not found" } }, url, 404));
    })
  );
}

describe("Thread — loading state", () => {
  it("renders skeleton before fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(<Thread id={1} />);
    expect(screen.getByLabelText("스레드 불러오는 중")).toBeInTheDocument();
    expect(document.querySelector(".today-skel")).toBeInTheDocument();
  });
});

describe("Thread — error state", () => {
  it("renders error alert", async () => {
    mockFetchError();
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Thread not found")).toBeInTheDocument();
  });
});

describe("Thread — access-session state", () => {
  it("renders access-session recovery when fetch returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 401,
      headers: { get: () => "text/html" },
      redirected: false, url: "/api/threads/1",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve("Cloudflare-Access")
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "로그인이 필요해" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "새로 고침" })).toBeInTheDocument();
  });
});

describe("Thread — empty items still expose relations", () => {
  it("shows quiet empty-items note inside live state, not a dead-end screen", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-empty")).toBeInTheDocument());
    // Header and relation section remain reachable even with no events/tasks.
    expect(screen.getByRole("heading", { name: "프로젝트 알파" })).toBeInTheDocument();
    expect(screen.getByTestId("thread-relations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "관계 추가" })).toBeInTheDocument();
  });

  it("opens the relation sheet from an empty thread (FR-THR-09 first-link path)", async () => {
    const threadData = {
      thread: BASE_THREAD, events: [], tasks: [],
      progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) {
        return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      }
      if (url.includes("/api/threads/1")) {
        return Promise.resolve(makeResponse({ ok: true, data: threadData }, url));
      }
      return Promise.resolve(makeResponse({ ok: true, data: [SUMMARY_OTHER] }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "관계 추가" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "하위 스레드" })).toBeInTheDocument());
  });
});

describe("Thread — live state", () => {
  it("renders thread header with name, goal, deadline, progress", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "프로젝트 알파" })).toBeInTheDocument());
    expect(screen.getByText("1분기 목표 달성")).toBeInTheDocument();
    expect(screen.getByText(/마감 2026-09-01/)).toBeInTheDocument();
    expect(screen.getByText("0/2")).toBeInTheDocument();
  });

  it("renders event and task spine nodes", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByText("킥오프 미팅")).toBeInTheDocument());
    expect(screen.getByText("자료 준비")).toBeInTheDocument();
  });

  it("past events appear below the divider", async () => {
    const pastEvent = {
      ...BASE_EVENT,
      id: 11,
      title: "지난 미팅",
      start: "2020-01-01T10:00:00+09:00",
      end: "2020-01-01T11:00:00+09:00"
    };
    mockFetch({
      thread: BASE_THREAD,
      events: [pastEvent],
      tasks: [],
      progress: { done: 0, total: 1 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByText("지난 항목")).toBeInTheDocument());
    expect(screen.getByText("지난 미팅")).toBeInTheDocument();
  });
});

describe("Thread — relations section", () => {
  it("shows empty relation state when no relations", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [],
      progress: { done: 0, total: 1 }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.getByText("아직 연결된 스레드가 없어")).toBeInTheDocument();
  });

  it("renders outgoing relation with peer name and delete button", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [],
      progress: { done: 0, total: 1 },
      relations: { incoming: [], outgoing: [OUTGOING_LINK] }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("outgoing-relation")).toBeInTheDocument());
    expect(screen.getByText("하위 스레드")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "하위 스레드 관계 삭제" })).toBeInTheDocument();
  });

  it("renders incoming relation without delete button", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [],
      progress: { done: 0, total: 1 },
      relations: { incoming: [INCOMING_LINK], outgoing: [] }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("incoming-relation")).toBeInTheDocument());
    expect(screen.getByText("상위 스레드")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /관계 삭제/ })).not.toBeInTheDocument();
  });

  it("relation link for outgoing peer goes to /threads/:id", async () => {
    mockFetch({
      thread: BASE_THREAD,
      events: [BASE_EVENT],
      tasks: [],
      progress: { done: 0, total: 1 },
      relations: { incoming: [], outgoing: [OUTGOING_LINK] }
    });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByText("하위 스레드")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "하위 스레드" })).toHaveAttribute("href", "/threads/2");
  });

  it("delete link calls DELETE and refreshes", async () => {
    let callCount = 0;
    const threadWithLink = {
      thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
      progress: { done: 0, total: 1 },
      relations: { incoming: [], outgoing: [OUTGOING_LINK] }, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T
    };
    const threadNoLink = {
      thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
      progress: { done: 0, total: 1 },
      relations: { incoming: [], outgoing: [] }, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (opts?.method === "DELETE") return Promise.resolve(makeResponse({ ok: true }, url));
      // Thread detail — first call returns with link, subsequent calls after delete return no link
      callCount++;
      const data = callCount <= 1 ? threadWithLink : threadNoLink;
      return Promise.resolve(makeResponse({ ok: true, data }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "하위 스레드 관계 삭제" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "하위 스레드 관계 삭제" }));
    await waitFor(() => expect(screen.getByText("아직 연결된 스레드가 없어")).toBeInTheDocument());
  });
});

describe("Thread — add link sheet", () => {
  const THREAD_DATA = {
    thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
    progress: { done: 0, total: 1 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T
  };

  function mockWithSheet(threads: ThreadSummary[] = [SUMMARY_OTHER]) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: THREAD_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: threads }, url));
    }));
  }

  it("opens sheet and shows thread options excluding current thread", async () => {
    mockWithSheet();
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "관계 추가" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "하위 스레드" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "프로젝트 알파" })).not.toBeInTheDocument();
  });

  it("shows 409 CONTAINS_CYCLE error message and keeps sheet open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("/api/threads/1/links") && opts?.method === "POST") {
        return Promise.resolve(makeResponse({ ok: false, error: { code: "CONTAINS_CYCLE", message: "cycle" } }, url, 409));
      }
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: THREAD_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [SUMMARY_OTHER] }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "관계 추가" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "하위 스레드" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("대상 스레드"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "연결하기 →" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("이 연결은 순환 구조를 만들어. 다른 방향을 선택해봐.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows 409 CONTAINS_PARENT_CONFLICT specific copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("/api/threads/1/links") && opts?.method === "POST") {
        return Promise.resolve(makeResponse({ ok: false, error: { code: "CONTAINS_PARENT_CONFLICT", message: "conflict" } }, url, 409));
      }
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: THREAD_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [SUMMARY_OTHER] }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => screen.getByRole("button", { name: "관계 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    await waitFor(() => screen.getByRole("option", { name: "하위 스레드" }));
    fireEvent.change(screen.getByLabelText("대상 스레드"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "연결하기 →" }));
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByText("이 스레드는 이미 다른 상위 스레드가 있어.")).toBeInTheDocument();
  });

  it("successful add closes sheet and refreshes relations", async () => {
    let threadCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("/api/threads/1/links") && opts?.method === "POST") {
        return Promise.resolve(makeResponse({
          ok: true, data: { link: { id: 200, fromThread: 1, toThread: 2, kind: "contains", firmness: "hard", createdAt: null } }
        }, url, 201));
      }
      if (url.includes("/api/threads/1")) {
        threadCallCount++;
        // After adding a link, refresh returns the outgoing relation.
        const data = threadCallCount > 1
          ? { ...THREAD_DATA, relations: { incoming: [], outgoing: [OUTGOING_LINK] } }
          : THREAD_DATA;
        return Promise.resolve(makeResponse({ ok: true, data }, url));
      }
      return Promise.resolve(makeResponse({ ok: true, data: [SUMMARY_OTHER] }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => screen.getByRole("button", { name: "관계 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
    await waitFor(() => screen.getByRole("option", { name: "하위 스레드" }));
    fireEvent.change(screen.getByLabelText("대상 스레드"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "연결하기 →" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("outgoing-relation")).toBeInTheDocument());
  });
});

describe("Thread — rollup section", () => {
  it("shows quiet no-children state when rollup has no children", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("rollup-no-children")).toBeInTheDocument());
    expect(screen.queryByTestId("rollup-metrics")).not.toBeInTheDocument();
  });

  it("shows metrics table and child drilldown when rollup has children", async () => {
    const rollup = {
      ...EMPTY_ROLLUP,
      direct: { progress: { done: 1, total: 3 }, energyHours: 2 },
      contains: { childCount: 1, descendantCount: 1, progress: { done: 2, total: 4 }, energyHours: 3, missingCost: null as null, missingCostStatus: "unavailable" as const },
      total: { progress: { done: 3, total: 7 }, energyHours: 5, missingCost: null as null, missingCostStatus: "unavailable" as const },
      children: [{ thread: { id: 2, name: "하위 스레드" }, depth: 1, relationId: 10, progress: { done: 2, total: 4 }, energyHours: 3, descendantCount: 0 }]
    };
    mockFetch({ thread: BASE_THREAD, events: [BASE_EVENT], tasks: [], progress: { done: 1, total: 1 }, rollup });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("rollup-metrics")).toBeInTheDocument());
    expect(screen.getByTestId("rollup-children")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "하위 스레드" })).toHaveAttribute("href", "/threads/2");
  });

  it("shows warning when rollup.warnings is non-empty", async () => {
    const rollup = { ...EMPTY_ROLLUP, warnings: ["CONTAINS_CYCLE_DETECTED"] };
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, rollup });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("rollup-warning")).toBeInTheDocument());
    expect(screen.getByTestId("rollup-warning")).toHaveTextContent("CONTAINS_CYCLE_DETECTED");
  });
});

describe("Thread — resource-focus section", () => {
  const FOCUS_DATA: ThreadResourceFocusData = {
    threadId: 1,
    resources: [
      {
        resource: { id: 10, name: "노트북", kind: "item", sourcePersonId: null, note: null, createdAt: null },
        sourcePerson: null,
        links: [
          { targetType: "event", targetId: 10, firmness: "hard", reason: "발표 때 필요" }
        ]
      },
      {
        resource: { id: 11, name: "충전기", kind: "item", sourcePersonId: null, note: null, createdAt: null },
        sourcePerson: null,
        links: [
          { targetType: "task", targetId: 20, firmness: "soft", reason: null }
        ]
      }
    ]
  };

  it("fetches resource-focus endpoint alongside thread detail", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: FOCUS_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("resource-focus")).toBeInTheDocument());
    const calledUrls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calledUrls.some((u) => u.includes("resource-focus"))).toBe(true);
  });

  it("hides resource-focus section when no resources are linked", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } }, EMPTY_FOCUS);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.queryByTestId("resource-focus")).not.toBeInTheDocument();
  });

  it("renders resource chips for each linked resource", async () => {
    mockFetch({ thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 } }, FOCUS_DATA);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("resource-focus")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "충전기" })).toBeInTheDocument();
  });

  it("selecting a resource chip highlights linked event and dims unrelated task", async () => {
    mockFetch({ thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 } }, FOCUS_DATA);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    // Event 10 is linked to 노트북 → resource-highlight
    const eventNode = document.querySelector(`[data-event-id="10"]`);
    expect(eventNode?.className).toContain("resource-highlight");
    // Task 20 is NOT linked to 노트북 → resource-dimmed
    const taskNode = document.querySelector(`[data-task-id="20"]`);
    expect(taskNode?.className).toContain("resource-dimmed");
  });

  it("clicking active chip again deselects it and removes all highlight/dim", async () => {
    mockFetch({ thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 } }, FOCUS_DATA);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    const eventNode = document.querySelector(`[data-event-id="10"]`);
    expect(eventNode?.className).not.toContain("resource-highlight");
    expect(eventNode?.className).not.toContain("resource-dimmed");
  });

  it("focus fetch failure leaves thread detail usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.reject(new Error("network error"));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "프로젝트 알파" })).toBeInTheDocument());
    expect(screen.queryByTestId("resource-focus")).not.toBeInTheDocument();
  });

  it("firmness is visible in resource detail", async () => {
    mockFetch({ thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 } }, FOCUS_DATA);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("resource-detail")).toBeInTheDocument());
    expect(screen.getByText("확정")).toBeInTheDocument();
  });

  // ── Ego graph (작은 관계) in resource detail ──────────────────────────────
  const EGO_RESOURCE = {
    center: { id: "resource:10", type: "resource", targetId: 10, label: "노트북" },
    nodes: [
      { id: "resource:10", type: "resource", targetId: 10, label: "노트북" },
      { id: "event:10", type: "event", targetId: 10, label: "발표 리허설", sublabel: "발표 준비" }
    ],
    edges: [
      { from: "resource:10", to: "event:10", kind: "resource_link", firmness: "hard", reason: "발표 때 필요" }
    ],
    truncated: false
  };

  function mockFetchWithEgo(ego: unknown) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/relations/ego")) return Promise.resolve(makeResponse(ego, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: FOCUS_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    }));
  }

  it("ego graph is not fetched on load (tap-only)", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/relations/ego")) return Promise.resolve(makeResponse({ ok: true, data: EGO_RESOURCE }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: FOCUS_DATA }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK], progress: { done: 0, total: 2 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("resource-detail")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c: unknown[]) => (c[0] as string).includes("/api/relations/ego"))).toBe(false);
    expect(screen.getByTestId("ego-open-btn")).toBeInTheDocument();
  });

  it("loads ego sheet on '작은 관계 보기' tap", async () => {
    mockFetchWithEgo({ ok: true, data: EGO_RESOURCE });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("ego-open-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ego-open-btn"));
    await waitFor(() => expect(screen.getByTestId("ego-sheet")).toBeInTheDocument());
    // Bottom-sheet dialog semantics (ISSUE-2)
    const dialog = screen.getByRole("dialog", { name: "작은 관계 보기" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const nodes = screen.getAllByTestId("ego-node");
    expect(nodes).toHaveLength(1); // center excluded
    expect(nodes[0]!).toHaveTextContent("발표 리허설");
    // edge row carries firmness + reason both visible (ISSUE-3)
    const edges = screen.getAllByTestId("ego-edge");
    expect(edges).toHaveLength(1);
    expect(edges[0]!).toHaveTextContent("노트북");
    expect(edges[0]!).toHaveTextContent("발표 리허설");
    expect(edges[0]!).toHaveTextContent("리소스 연결");
    expect(edges[0]!).toHaveTextContent("hard");
    expect(screen.getByTestId("ego-edge-reason")).toHaveTextContent("발표 때 필요");
  });

  it("renders non-center thread_link edge in the edge list (ISSUE-5)", async () => {
    const egoWithThreadLink = {
      center: { id: "resource:10", type: "resource", targetId: 10, label: "공용 자료" },
      nodes: [
        { id: "resource:10", type: "resource", targetId: 10, label: "공용 자료" },
        { id: "thread:1", type: "thread", targetId: 1, label: "발표 준비", href: "/threads/1" },
        { id: "thread:2", type: "thread", targetId: 2, label: "출장 준비", href: "/threads/2" }
      ],
      edges: [
        { from: "resource:10", to: "thread:1", kind: "resource_link", firmness: "soft" },
        { from: "resource:10", to: "thread:2", kind: "resource_link", firmness: "soft" },
        { from: "thread:1", to: "thread:2", kind: "thread_link", firmness: "soft", relationKind: "feeds" }
      ],
      truncated: false
    };
    mockFetchWithEgo({ ok: true, data: egoWithThreadLink });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("ego-open-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ego-open-btn"));
    await waitFor(() => expect(screen.getByTestId("ego-sheet")).toBeInTheDocument());
    const edges = screen.getAllByTestId("ego-edge");
    expect(edges).toHaveLength(3);
    // The non-center thread→thread edge must be visible with kind + relationKind + firmness.
    const tlEdge = edges.find((e) => e.textContent?.includes("스레드 연결"));
    expect(tlEdge).toBeDefined();
    expect(tlEdge!).toHaveTextContent("발표 준비");
    expect(tlEdge!).toHaveTextContent("출장 준비");
    expect(tlEdge!).toHaveTextContent("연결"); // relationKind feeds → 연결
    expect(tlEdge!).toHaveTextContent("soft");
  });

  it("Escape closes the ego sheet (ISSUE-2 keyboard)", async () => {
    mockFetchWithEgo({ ok: true, data: EGO_RESOURCE });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("ego-open-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ego-open-btn"));
    await waitFor(() => expect(screen.getByTestId("ego-sheet")).toBeInTheDocument());
    fireEvent.keyDown(screen.getByTestId("ego-sheet").parentElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("ego-sheet")).not.toBeInTheDocument());
  });

  it("ego sheet shows error copy when fetch fails", async () => {
    mockFetchWithEgo({ ok: false, error: { message: "boom" } });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "노트북" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "노트북" }));
    await waitFor(() => expect(screen.getByTestId("ego-open-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("ego-open-btn"));
    await waitFor(() => expect(screen.getByText("관계 정보를 불러올 수 없습니다.")).toBeInTheDocument());
  });
});

describe("Thread — promotion suggestions panel", () => {
  const SUGGESTION: PromotionSuggestion = {
    candidateKey: "노트북::item::event:10,task:20",
    name: "노트북",
    kind: "item",
    occurrenceCount: 2,
    occurrences: [
      { targetType: "event", targetId: 10 },
      { targetType: "task", targetId: 20 }
    ]
  };

  it("hides panel when no suggestions", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } }, EMPTY_FOCUS, []);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.queryByTestId("promotion-suggestions")).not.toBeInTheDocument();
  });

  it("shows panel and suggestion card when suggestions exist", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } }, EMPTY_FOCUS, [SUGGESTION]);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("promotion-suggestions")).toBeInTheDocument());
    expect(screen.getByTestId("promotion-suggestion-card")).toBeInTheDocument();
    expect(screen.getByText(/노트북이\(가\) 2곳에 나타나/)).toBeInTheDocument();
  });

  it("shows approve button for each suggestion", async () => {
    mockFetch({ thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 } }, EMPTY_FOCUS, [SUGGESTION]);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("promotion-approve-btn")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "노트북 리소스로 승인" })).toBeInTheDocument();
  });

  it("approve button calls POST and refreshes (panel disappears on success)", async () => {
    let approveCallCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("promotion-suggestions") && opts?.method === "POST") {
        approveCallCount++;
        return Promise.resolve(makeResponse({ ok: true, data: { resource: { id: 50, name: "노트북", kind: "item", sourcePersonId: null, note: null, createdAt: null }, links: [], reusedResource: false } }, url, 201));
      }
      if (url.includes("promotion-suggestions")) {
        // After approve, return empty suggestions on refresh
        return Promise.resolve(makeResponse({ ok: true, data: { suggestions: approveCallCount > 0 ? [] : [SUGGESTION] } }, url));
      }
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("promotion-approve-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("promotion-approve-btn"));
    expect(approveCallCount).toBe(1);
    await waitFor(() => expect(screen.queryByTestId("promotion-suggestions")).not.toBeInTheDocument());
  });

  it("shows scoped error alert on approve failure, not full-thread error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("promotion-suggestions") && opts?.method === "POST") {
        return Promise.resolve(makeResponse({ ok: false, error: { code: "PROMOTION_STALE", message: "stale" } }, url, 409));
      }
      if (url.includes("promotion-suggestions")) {
        return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [SUGGESTION] } }, url));
      }
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("promotion-approve-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("promotion-approve-btn"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/제안이 바뀌었어/)).toBeInTheDocument();
    // Thread detail still shown — not a full error state
    expect(screen.getByRole("heading", { name: "프로젝트 알파" })).toBeInTheDocument();
  });

  it("error alert can be dismissed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.includes("promotion-suggestions") && opts?.method === "POST") {
        return Promise.resolve(makeResponse({ ok: false, error: { code: "PROMOTION_STALE", message: "stale" } }, url, 409));
      }
      if (url.includes("promotion-suggestions")) {
        return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [SUGGESTION] } }, url));
      }
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      return Promise.resolve(makeResponse({ ok: true, data: { thread: BASE_THREAD, events: [], tasks: [], progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T } }, url));
    }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("promotion-approve-btn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("promotion-approve-btn"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "오류 닫기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ThreadIndex — relation count chips", () => {
  it("shows count chips when relations > 0", async () => {
    const { ThreadIndex } = await import("./ThreadIndex.js");
    const summaryWithRelations = {
      thread: { id: 5, name: "연결된 스레드", kind: null, goal: null, definitionOfDone: null, deadline: null, status: "active" as const, createdAt: null },
      eventCount: 0, taskCount: 0, doneCount: 0, totalCount: 0,
      relationCounts: { incoming: 2, outgoing: 1 }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      redirected: false, url: "/api/threads",
      json: () => Promise.resolve({ ok: true, data: [summaryWithRelations] })
    }));
    const { cleanup: c, screen: s } = await import("@testing-library/react");
    const { render: r } = await import("@testing-library/react");
    r(<ThreadIndex />);
    await waitFor(() => expect(s.getByLabelText("들어오는 관계 2개")).toBeInTheDocument());
    expect(s.getByLabelText("나가는 관계 1개")).toBeInTheDocument();
    c();
  });
});

describe("Thread — node edit + confirm (cycle-50)", () => {
  const NODE_LINK = {
    id: 7, kind: "requires" as const, firmness: "soft" as const, source: "inferred" as const,
    from: { kind: "event" as const, id: 10, title: "킥오프 미팅" },
    to: { kind: "task" as const, id: 20, title: "자료 준비" }
  };

  function detailWith(over: Partial<ThreadDetail> = {}): ThreadDetail {
    return {
      thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T, ...over
    } as ThreadDetail;
  }

  function stub(detail: ThreadDetail, onPatch?: (url: string, opts?: { method?: string }) => unknown) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH") return Promise.resolve(makeResponse(onPatch?.(url, opts) ?? { ok: true, data: {} }, url));
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: detail }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [] }, url));
    }));
  }

  it("event card edit opens inline form, saves via PATCH, and refreshes", async () => {
    const calls: string[] = [];
    stub(detailWith(), (url) => { calls.push(url); return { ok: true, data: { event: BASE_EVENT } }; });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("event-edit-10")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("event-edit-10"));
    const form = await screen.findByTestId("event-form-10");
    expect(form).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("이벤트 제목"), { target: { value: "새 제목" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.some((u) => u.includes("/api/events/10/thread-node"))).toBe(true));
  });

  it("event card edit shows a role=alert error on failure", async () => {
    stub(detailWith(), () => ({ ok: false, error: { code: "VALIDATION_ERROR", message: "안돼" } }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("event-edit-10")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("event-edit-10"));
    await screen.findByTestId("event-form-10");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("안돼"));
  });

  it("task card edit opens inline form and saves via PATCH", async () => {
    const calls: string[] = [];
    stub(detailWith(), (url) => { calls.push(url); return { ok: true, data: { task: BASE_TASK } }; });
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("task-edit-20")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("task-edit-20"));
    await screen.findByTestId("task-form-20");
    fireEvent.change(screen.getByLabelText("작업 제목"), { target: { value: "새 작업" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.some((u) => u.includes("/api/tasks/20/thread-node"))).toBe(true));
  });

  it("node link section shows firmness/source evidence and a 확인 button for non-confirmed links", async () => {
    stub(detailWith({ nodeLinks: [NODE_LINK] }));
    render(<Thread id={1} />);
    const section = await screen.findByTestId("thread-node-links");
    expect(section).toHaveTextContent("킥오프 미팅 → 자료 준비");
    expect(screen.getByTestId("node-link-firmness-7")).toHaveTextContent("약함");
    expect(screen.getByTestId("node-link-confirm-7")).toBeInTheDocument();
  });

  it("confirmed (hard/authored) link shows confirmed state and no 확인 button", async () => {
    stub(detailWith({ nodeLinks: [{ ...NODE_LINK, firmness: "hard", source: "authored" }] }));
    render(<Thread id={1} />);
    await screen.findByTestId("thread-node-links");
    expect(screen.getByTestId("node-link-confirmed-7")).toBeInTheDocument();
    expect(screen.queryByTestId("node-link-confirm-7")).not.toBeInTheDocument();
  });

  it("confirm button calls the confirm route and refreshes", async () => {
    const calls: string[] = [];
    stub(detailWith({ nodeLinks: [NODE_LINK] }), (url) => { calls.push(url); return { ok: true, data: { link: NODE_LINK, reused: false } }; });
    render(<Thread id={1} />);
    await screen.findByTestId("node-link-confirm-7");
    fireEvent.click(screen.getByTestId("node-link-confirm-7"));
    await waitFor(() => expect(calls.some((u) => u.includes("/api/threads/1/node-links/7/confirm"))).toBe(true));
  });

  it("does not render the node-links section when there are none", async () => {
    stub(detailWith({ nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.queryByTestId("thread-node-links")).not.toBeInTheDocument();
  });
});

describe("Thread — unknown blockers (cycle-52)", () => {
  const BLOCKER: ThreadUnknownBlocker = {
    id: "link:7:task.estMinutes", linkId: 7, linkKind: "requires",
    firmness: "soft", source: "inferred",
    prerequisite: { kind: "task", id: 20, title: "자료 준비" },
    blockedNode: { kind: "event", id: 10, title: "킥오프 미팅" },
    missingField: "task.estMinutes", blockedField: "event.start",
    message: "‘자료 준비’의 예상 소요 시간이 없어 ‘킥오프 미팅’ 일정을 역산할 수 없어.",
    reasonCodes: ["blocker_missing_duration", "blocker_soft_link"]
  };

  function detail(over: Partial<ThreadDetail> = {}): ThreadDetail {
    return {
      thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T, ...over
    } as ThreadDetail;
  }
  function stub(d: ThreadDetail) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "PATCH" || opts?.method === "POST") return Promise.resolve(makeResponse({ ok: true, data: {} }, url));
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: d }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [] }, url));
    }));
  }

  it("renders no unknown-blockers section when the array is empty", async () => {
    stub(detail({ unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.queryByTestId("thread-unknown-blockers")).not.toBeInTheDocument();
  });

  it("renders blocker cards with prerequisite/blocked labels, missing-field copy, and firmness/source evidence", async () => {
    stub(detail({ unknownBlockers: [BLOCKER] }));
    render(<Thread id={1} />);
    const section = await screen.findByTestId("thread-unknown-blockers");
    expect(section).toHaveTextContent("입력 필요");
    const card = screen.getByTestId("unknown-blocker-link:7:task.estMinutes");
    expect(card).toHaveTextContent("자료 준비 → 킥오프 미팅");
    expect(card).toHaveTextContent("일정을 역산할 수 없어");
    expect(screen.getByTestId("blocker-missing-link:7:task.estMinutes")).toHaveTextContent("예상 소요 시간 없음");
    expect(screen.getByTestId("blocker-firmness-link:7:task.estMinutes")).toHaveTextContent("약함");
  });

  it("does not fire PATCH/POST on render and shows no apply/schedule control", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: detail({ unknownBlockers: [BLOCKER] }) }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [] }, url));
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Thread id={1} />);
    await screen.findByTestId("thread-unknown-blockers");
    expect(fetchSpy.mock.calls.every((c) => (c[1]?.method ?? "GET") === "GET")).toBe(true);
    expect(screen.queryByRole("button", { name: /적용|일정|예약|확인/ })).not.toBeInTheDocument();
  });
});

describe("Thread — settlement (cycle-53)", () => {
  const READY_SETTLEMENT: ThreadSettlement = {
    status: "ready",
    paidCost: { eventCount: 2, money: 4000, social: 1, effort: { none: 0, low: 1, medium: 1, high: 0, unknown: 0 }, windowCount: 1 },
    avoidedMissing: { doneCount: 2, totalCount: 3, knownAvoidedCount: 2, unknownCostCount: 1, money: null, moneyStatus: "unavailable" },
    sampleStatus: "partial",
    reasonCodes: ["settlement_ready", "settlement_partial", "settlement_paid_cost_present", "settlement_avoided_money_unavailable"]
  };
  function detail(over: Partial<ThreadDetail> = {}): ThreadDetail {
    return {
      thread: BASE_THREAD, events: [BASE_EVENT], tasks: [BASE_TASK],
      progress: { done: 0, total: 2 }, relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP,
      nodeLinks: [], unknownBlockers: [], settlement: EMPTY_SETTLEMENT_T, ...over
    } as ThreadDetail;
  }
  function stub(d: ThreadDetail) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: d }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [] }, url));
    }));
  }

  it("renders the settlement section with paid + avoided evidence when ready", async () => {
    stub(detail({ settlement: READY_SETTLEMENT }));
    render(<Thread id={1} />);
    const section = await screen.findByTestId("thread-settlement");
    expect(section).toHaveTextContent("정산");
    expect(screen.getByTestId("settlement-paid")).toHaveTextContent("이동·취소 2건");
    expect(screen.getByTestId("settlement-paid")).toHaveTextContent("금액 4,000");
    expect(screen.getByTestId("settlement-avoided")).toHaveTextContent("완료 2/3");
    expect(screen.getByTestId("settlement-unknown")).toHaveTextContent("미정 1건");
    expect(screen.getByTestId("settlement-partial-note")).toBeInTheDocument();
  });

  it("does not render the settlement card when not ready", async () => {
    stub(detail({ settlement: EMPTY_SETTLEMENT_T }));
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByTestId("thread-relations")).toBeInTheDocument());
    expect(screen.queryByTestId("thread-settlement")).not.toBeInTheDocument();
  });

  it("settlement render fires no PATCH/POST and shows no apply/CV control", async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes("resource-focus")) return Promise.resolve(makeResponse({ ok: true, data: EMPTY_FOCUS }, url));
      if (url.includes("promotion-suggestions")) return Promise.resolve(makeResponse({ ok: true, data: { suggestions: [] } }, url));
      if (url.includes("/api/threads/1")) return Promise.resolve(makeResponse({ ok: true, data: detail({ settlement: READY_SETTLEMENT }) }, url));
      return Promise.resolve(makeResponse({ ok: true, data: [] }, url));
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Thread id={1} />);
    await screen.findByTestId("thread-settlement");
    expect(fetchSpy.mock.calls.every((c) => (c[1]?.method ?? "GET") === "GET")).toBe(true);
    expect(screen.queryByRole("button", { name: /적용|정산하기|이력서|완료 처리/ })).not.toBeInTheDocument();
  });
});
