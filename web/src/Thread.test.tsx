import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Thread } from "./Thread.js";
import type { ThreadDetail, ThreadLinkView, ThreadRollup, ThreadSummary } from "@cairn/shared";

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
  source: "cairn" as const, selfImposed: 1,
  status: "planned" as const, createdAt: null, updatedAt: null
};

const BASE_TASK = {
  id: 20, threadId: 1, title: "자료 준비",
  estMinutes: 30, due: null, context: null,
  status: "todo" as const, optional: 0, createdAt: null
};

const EMPTY_RELATIONS: ThreadDetail["relations"] = { incoming: [], outgoing: [] };

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

function mockFetch(detail: Omit<ThreadDetail, "relations" | "rollup"> & Partial<Pick<ThreadDetail, "relations" | "rollup">>) {
  const data: ThreadDetail = { relations: EMPTY_RELATIONS, rollup: EMPTY_ROLLUP, ...detail };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      redirected: false,
      url: "/api/threads/1",
      json: () => Promise.resolve({ ok: true, data })
    })
  );
}

function mockFetchError(code = "NOT_FOUND") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => "application/json" },
      redirected: false,
      url: "/api/threads/1",
      json: () => Promise.resolve({ ok: false, error: { code, message: "Thread not found" } })
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
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [], tasks: [],
            progress: { done: 0, total: 0 }, relations: EMPTY_RELATIONS,
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValue({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads",
        json: () => Promise.resolve({ ok: true, data: [SUMMARY_OTHER] })
      })
    );
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
    const mockFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 },
            relations: { incoming: [], outgoing: [OUTGOING_LINK] },
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1/links/100",
        json: () => Promise.resolve({ ok: true })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 },
            relations: { incoming: [], outgoing: [] },
            rollup: EMPTY_ROLLUP
          }
        })
      });
    vi.stubGlobal("fetch", mockFn);
    render(<Thread id={1} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "하위 스레드 관계 삭제" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "하위 스레드 관계 삭제" }));
    await waitFor(() => expect(screen.getByText("아직 연결된 스레드가 없어")).toBeInTheDocument());
  });
});

describe("Thread — add link sheet", () => {
  function mockWithSheet(threads: ThreadSummary[] = [SUMMARY_OTHER]) {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 }, relations: EMPTY_RELATIONS,
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValue({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads",
        json: () => Promise.resolve({ ok: true, data: threads })
      })
    );
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
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 }, relations: EMPTY_RELATIONS,
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads",
        json: () => Promise.resolve({ ok: true, data: [SUMMARY_OTHER] })
      })
      .mockResolvedValueOnce({
        ok: true, status: 409,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1/links",
        json: () => Promise.resolve({ ok: false, error: { code: "CONTAINS_CYCLE", message: "cycle" } })
      })
    );
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
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 }, relations: EMPTY_RELATIONS,
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads",
        json: () => Promise.resolve({ ok: true, data: [SUMMARY_OTHER] })
      })
      .mockResolvedValueOnce({
        ok: true, status: 409,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1/links",
        json: () => Promise.resolve({ ok: false, error: { code: "CONTAINS_PARENT_CONFLICT", message: "conflict" } })
      })
    );
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
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 }, relations: EMPTY_RELATIONS,
            rollup: EMPTY_ROLLUP
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads",
        json: () => Promise.resolve({ ok: true, data: [SUMMARY_OTHER] })
      })
      .mockResolvedValueOnce({
        ok: true, status: 201,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1/links",
        json: () => Promise.resolve({
          ok: true, data: { link: { id: 200, fromThread: 1, toThread: 2, kind: "contains", firmness: "hard", createdAt: null } }
        })
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        redirected: false, url: "/api/threads/1",
        json: () => Promise.resolve({
          ok: true, data: {
            thread: BASE_THREAD, events: [BASE_EVENT], tasks: [],
            progress: { done: 0, total: 1 },
            relations: { incoming: [], outgoing: [OUTGOING_LINK] },
            rollup: EMPTY_ROLLUP
          }
        })
      })
    );
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
