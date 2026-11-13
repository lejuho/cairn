import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { NoteView } from "@cairn/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNav } from "./AppNav.js";
import { AttachedNotes, NoteFlow, NotesPage } from "./Notes.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

function note(over: Partial<NoteView> = {}): NoteView {
  return {
    id: 1, kind: "note", title: null, body: "평가 기준은 재현성 위주", noteDate: "2026-03-12", pinned: false, remoteVisible: false,
    items: [], links: [], addedBy: "web", createdAt: "2026-03-12T06:00:00.000Z", updatedAt: "2026-03-12T06:00:00.000Z", archivedAt: null,
    ...over
  };
}

const CHECKLIST = note({
  id: 2, kind: "checklist", title: "면담 준비", body: null,
  items: [
    { id: 11, text: "슬라이드", done: false, doneAt: null, position: 0, taskId: null },
    { id: 12, text: "질문 목록", done: true, doneAt: "2026-03-11T01:00:00.000Z", position: 1, taskId: null }
  ],
  links: [{ targetType: "event", targetId: 7, label: "지도교수 면담", when: "2026-03-12T15:00:00+09:00", status: "done", exists: true }]
});

function json(data: unknown, ok = true) {
  return { ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve(ok ? { ok: true, data } : { ok: false, error: { message: String(data) } }) };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function stubFetch(handler: Handler) {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(String(url), init)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("NotesPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/notes");
  });

  it("shows a skeleton while loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<NotesPage />);
    expect(screen.getByLabelText("메모 불러오는 중")).toBeInTheDocument();
  });

  it("stays quiet when there are no notes yet: just the way to write one", async () => {
    stubFetch(() => json({ notes: [], total: 0, related: [] }));
    render(<NotesPage />);
    await waitFor(() => expect(screen.queryByLabelText("메모 불러오는 중")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "+ 새 메모" })).toBeInTheDocument();
    expect(screen.queryByTestId("notes-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notes-live")).not.toBeInTheDocument();
  });

  it("shows an error with a retry that recovers", async () => {
    let fail = true;
    stubFetch(() => (fail ? json("DB 잠김", false) : json({ notes: [note()], total: 1, related: [] })));
    render(<NotesPage />);
    expect(await screen.findByText("메모를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("DB 잠김")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("평가 기준은 재현성 위주")).toBeInTheDocument();
  });

  it("lists notes grouped by day with their attached targets", async () => {
    stubFetch(() => json({ notes: [note(), CHECKLIST], total: 2, related: [] }));
    render(<NotesPage />);
    const group = await screen.findByRole("region", { name: /2026년 3월 12일/ });
    expect(within(group).getByText("평가 기준은 재현성 위주")).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: /지도교수 면담/ })).toHaveAttribute("href", "/notes?targetType=event&targetId=7");
    expect(within(group).getByRole("list", { name: "체크리스트 (1/2 완료)" })).toBeInTheDocument();
  });

  it("searches as you type and lets a matching past event narrow the list", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("q=")) {
        return json({
          notes: [CHECKLIST], total: 1,
          related: [{ targetType: "event", targetId: 7, label: "지도교수 면담", when: "2026-03-12T15:00:00+09:00", status: "done", exists: true, noteCount: 1, location: "T동 501" }]
        });
      }
      return json({ notes: [note(), CHECKLIST], total: 2, related: [] });
    });
    render(<NotesPage />);
    await screen.findByText("평가 기준은 재현성 위주");

    fireEvent.change(screen.getByLabelText("메모 검색"), { target: { value: "면담" } });
    const related = await screen.findByRole("button", { name: /지도교수 면담.*2026-03-12.*T동 501.*메모 1/ });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`q=${encodeURIComponent("면담")}`))).toBe(true);

    fireEvent.click(related);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("targetType=event&targetId=7"))).toBe(true));
    expect(await screen.findByText("에 붙은 메모만 보는 중")).toBeInTheDocument();
    expect(window.location.search).toContain("targetId=7");
  });

  it("reads date and target filters from the URL", async () => {
    window.history.replaceState(null, "", "/notes?date=2026-03-12");
    const fetchMock = stubFetch(() => json({ notes: [], total: 0, related: [] }));
    render(<NotesPage />);
    await screen.findByText("검색 결과 없음");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/notes?date=2026-03-12");
    // 그 날짜를 보던 중에 쓰는 메모는 그 날짜로 시작한다.
    fireEvent.click(screen.getByRole("button", { name: "+ 새 메모" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "그날 일" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    expect(screen.getByLabelText("메모 날짜")).toHaveValue("2026-03-12");
  });

  it("keeps what was written and says so when saving fails", async () => {
    stubFetch((_url, init) => (init?.method === "POST" ? json("저장 실패", false) : json({ notes: [], total: 0, related: [] })));
    render(<NotesPage />);
    await waitFor(() => expect(screen.queryByLabelText("메모 불러오는 중")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "+ 새 메모" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "잃으면 안 되는 글" } });
    fireEvent.click(screen.getByRole("button", { name: "오늘로 바로 저장" }));
    expect(await screen.findByText("저장 실패")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "빠른 기록" })).toBeInTheDocument();
    expect(screen.getByLabelText("1번째 줄")).toHaveValue("잃으면 안 되는 글");
  });
});

describe("line editor", () => {
  function openFlow() {
    stubFetch(() => json({ targets: [] }));
    render(<NoteFlow defaultDate="2026-11-12" onClose={() => undefined} />);
  }

  it("starts a new bulleted row on Enter and splits the text at the caret", () => {
    openFlow();
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "장보기" } });
    // 엔터는 textarea 에 줄바꿈으로 들어온다 (어떤 키보드에서든).
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "장보기\n" } });
    expect(screen.getByLabelText("1번째 줄")).toHaveValue("장보기");
    expect(screen.getByLabelText("2번째 줄")).toHaveValue("");
    expect(screen.getByLabelText("2번째 줄")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("2번째 줄"), { target: { value: "우유계란" } });
    fireEvent.change(screen.getByLabelText("2번째 줄"), { target: { value: "우유\n계란" } });
    expect(screen.getByLabelText("2번째 줄")).toHaveValue("우유");
    expect(screen.getByLabelText("3번째 줄")).toHaveValue("계란");
    expect(within(screen.getByRole("list", { name: "메모 내용" })).getAllByText("•")).toHaveLength(3);
  });

  it("turns a pasted list into rows without its markers", () => {
    openFlow();
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "준비물\n- 여권\n[ ] 충전기\n* 우산" } });
    expect([1, 2, 3, 4].map((n) => (screen.getByLabelText(`${n}번째 줄`) as HTMLTextAreaElement).value)).toEqual(["준비물", "여권", "충전기", "우산"]);
    expect(screen.getByLabelText("4번째 줄")).toHaveFocus();
  });

  it("joins a row to the one above on Backspace at its start, from a key or a phone keyboard", () => {
    openFlow();
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "가\n나\n다" } });

    const third = screen.getByLabelText("3번째 줄") as HTMLTextAreaElement;
    third.setSelectionRange(0, 0);
    fireEvent.keyDown(third, { key: "Backspace" });
    expect(screen.getByLabelText("2번째 줄")).toHaveValue("나다");
    expect(screen.queryByLabelText("3번째 줄")).not.toBeInTheDocument();

    // 폰 키보드는 Backspace 키 이름을 주지 않고 beforeinput 만 보낸다.
    const second = screen.getByLabelText("2번째 줄") as HTMLTextAreaElement;
    second.setSelectionRange(0, 0);
    const event = new Event("beforeinput", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "inputType", { value: "deleteContentBackward" });
    act(() => { second.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("1번째 줄")).toHaveValue("가나다");

    // 글자 중간에서는 평소처럼 한 글자만 지운다.
    const first = screen.getByLabelText("1번째 줄") as HTMLTextAreaElement;
    first.setSelectionRange(2, 2);
    fireEvent.keyDown(first, { key: "Backspace" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("gives every checklist row its own checkbox", () => {
    openFlow();
    fireEvent.click(screen.getByRole("button", { name: "체크리스트" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "슬라이드\n질문 목록" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "1번째 항목 완료" }));
    expect(screen.getByRole("checkbox", { name: "1번째 항목 완료" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "2번째 항목 완료" })).not.toBeChecked();
  });
});

describe("note flow", () => {
  const THREAD = { targetType: "thread" as const, targetId: 3, label: "졸업 프로젝트", when: null, status: "active", exists: true };

  it("writes first, then shows the text beside the date and target choices, then saves", async () => {
    const posts: unknown[] = [];
    const onClose = vi.fn();
    stubFetch((url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({ note: note() });
      }
      return url.includes("/api/notes/targets") ? json({ targets: [THREAD] }) : json({ notes: [], total: 0, related: [] });
    });
    render(<NoteFlow defaultDate="2026-11-12" onClose={onClose} />);

    // 1단계: 쓰는 곳에는 날짜·대상 고르기가 없다.
    expect(screen.getByLabelText("1단계: 쓰기")).toBeInTheDocument();
    expect(screen.queryByLabelText("메모 날짜")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음: 붙일 곳 →" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "체크리스트" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "슬라이드\n질문 목록\n" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "2번째 항목 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));

    // 2단계: 쓴 내용은 읽기 전용으로 남고, 오른쪽에서 고른다.
    expect(screen.getByLabelText("2단계: 붙일 곳")).toBeInTheDocument();
    const written = screen.getByRole("region", { name: "쓴 내용" });
    expect(within(written).getByText("슬라이드")).toBeInTheDocument();
    expect(within(written).queryByRole("textbox")).not.toBeInTheDocument();
    const place = screen.getByRole("region", { name: "붙일 곳 고르기" });
    expect(within(place).getByLabelText("메모 날짜")).toHaveValue("2026-11-12");
    fireEvent.click(within(place).getByRole("button", { name: "없음" }));
    fireEvent.click(await within(place).findByRole("button", { name: /졸업 프로젝트/ }));
    expect(within(place).getByRole("list", { name: "붙인 곳" })).toHaveTextContent("졸업 프로젝트");

    fireEvent.click(screen.getByRole("button", { name: "저장 (날짜 없음 · 1곳에 붙임)" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts[0]).toEqual({
      kind: "checklist",
      items: [{ text: "슬라이드", done: false }, { text: "질문 목록", done: true }],
      links: [{ targetType: "thread", targetId: 3 }],
      addedBy: "web"
    });
  });

  it("keeps a note away from remote AI unless the switch is turned on", async () => {
    const posts: unknown[] = [];
    stubFetch((_url, init) => {
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      return init?.method === "POST" ? json({ note: note() }) : json({ targets: [] });
    });
    render(<NoteFlow defaultDate="2026-11-12" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "공유해도 되는 것" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));

    const toggle = screen.getByRole("switch", { name: "ChatGPT 같은 원격 AI에 공개" });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("꺼져 있으면 이 기기와 Pi 안에서만 보입니다.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("원격 AI가 이 메모를 읽을 수 있습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "저장 (11/12 · AI 공개)" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ body: "공유해도 되는 것", remoteVisible: true });
  });

  function recorder(handler: (url: string, body: unknown) => unknown = () => ({})) {
    const posts: Array<{ url: string; body: unknown }> = [];
    stubFetch((url, init) => {
      if (init?.method === "POST") {
        const body = init.body ? JSON.parse(String(init.body)) : null;
        if (!url.endsWith("/event-draft")) posts.push({ url, body });
        return json(handler(url, body));
      }
      return json({ targets: [THREAD] });
    });
    return posts;
  }

  it("turns the writing into one task: first line is the title, the rest its description", async () => {
    const posts = recorder();
    const onClose = vi.fn();
    render(<NoteFlow defaultDate="2026-11-12" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "보고서 초안 쓰기\n서론은 지난번 것 재사용" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));

    // 무엇으로 남길지는 다 쓴 뒤에 고른다.
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    expect(screen.getByText("첫 줄이 할 일 제목, 나머지는 설명이 됩니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("마감 날짜")).toHaveValue("2026-11-12");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "30분" }));
    fireEvent.click(await screen.findByRole("button", { name: /졸업 프로젝트/ }));

    fireEvent.click(screen.getByRole("button", { name: "할 일 만들기" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{
      url: "/api/tasks",
      body: { title: "보고서 초안 쓰기", context: "서론은 지난번 것 재사용", due: "2026-11-12", estMinutes: 30, threadId: 3 }
    }]);
  });

  it("turns a checklist into one task per item and keeps the checklist", async () => {
    const saved = note({ id: 9, kind: "checklist", body: null, items: [
      { id: 91, text: "장보기", done: false, doneAt: null, position: 0, taskId: null },
      { id: 92, text: "세탁소", done: false, doneAt: null, position: 1, taskId: null }
    ] });
    const posts = recorder((url) => (url === "/api/notes" ? { note: saved } : { note: saved, taskId: 1 }));
    const onClose = vi.fn();
    render(<NoteFlow defaultDate="2026-11-12" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "체크리스트" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "장보기\n세탁소" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(screen.getByRole("button", { name: "할 일" }));
    expect(screen.getByText("항목 2개가 각각 할 일이 됩니다. 체크리스트도 함께 남습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "없음" }));

    fireEvent.click(screen.getByRole("button", { name: "할 일 만들기 (2개)" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts.map((p) => p.url)).toEqual(["/api/notes", "/api/notes/9/items/91/task", "/api/notes/9/items/92/task"]);
    expect(posts[0]!.body).toEqual({ kind: "checklist", items: [{ text: "장보기", done: false }, { text: "세탁소", done: false }], addedBy: "web" });
  });

  it("turns one line into an event, filling date and time from AI unless the user already chose", async () => {
    let resolveDraft: (value: unknown) => void = () => undefined;
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === "/api/notes/event-draft") return new Promise((resolve) => { resolveDraft = resolve; });
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Promise.resolve(json({}));
      }
      return Promise.resolve(json({ targets: [] }));
    }));
    const onClose = vi.fn();
    render(<NoteFlow defaultDate="2026-11-12" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "다음 주 화요일 2시 은행 방문" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(screen.getByRole("button", { name: "일정" }));

    // 읽는 동안에도 바로 고를 수 있다.
    expect(screen.getByText(/쓴 글에서 날짜와 시간을 읽는 중/)).toBeInTheDocument();
    expect(screen.getByLabelText("일정 제목")).toHaveValue("다음 주 화요일 2시 은행 방문");
    expect(screen.getByLabelText("일정 날짜")).toHaveValue("2026-11-12");
    expect(screen.getByRole("button", { name: "일정 만들기" })).toBeEnabled();

    await act(async () => {
      resolveDraft(json({ title: "은행 방문", start: "2026-11-17T14:00:00+09:00", end: "2026-11-17T15:00:00+09:00", parseStatus: "parsed" }));
    });
    expect(await screen.findByText("쓴 글에서 읽은 값입니다. 맞는지 확인하고 고치세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("일정 제목")).toHaveValue("은행 방문");
    expect(screen.getByLabelText("일정 날짜")).toHaveValue("2026-11-17");
    expect(screen.getByLabelText("시작 시간")).toHaveValue("14:00");

    fireEvent.click(screen.getByRole("button", { name: "일정 만들기" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([{ url: "/api/events", body: { title: "은행 방문", start: "2026-11-17T14:00:00+09:00", end: "2026-11-17T15:00:00+09:00" } }]);
  });

  it("keeps the user's own time when AI answers late, and saves longer writing as a note on the event", async () => {
    let resolveDraft: (value: unknown) => void = () => undefined;
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (String(url) === "/api/notes/event-draft") return new Promise((resolve) => { resolveDraft = resolve; });
      if (init?.method === "POST") {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return Promise.resolve(json({ note: note({ id: 5 }), eventId: 8 }));
      }
      return Promise.resolve(json({ targets: [] }));
    }));
    const onClose = vi.fn();
    render(<NoteFlow defaultDate="2026-11-12" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "은행 방문\n신분증 챙기기" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(screen.getByRole("button", { name: "일정" }));
    expect(screen.getByText("일정을 만들고, 쓴 글은 그 일정의 메모로 붙습니다.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("일정 날짜"), { target: { value: "2026-11-13" } });
    fireEvent.change(screen.getByLabelText("시작 시간"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("끝 시간"), { target: { value: "11:30" } });
    await act(async () => {
      resolveDraft(json({ title: "AI 제목", start: "2026-11-17T14:00:00+09:00", end: "2026-11-17T15:00:00+09:00", parseStatus: "parsed" }));
    });
    expect(screen.getByLabelText("시작 시간")).toHaveValue("11:00");
    expect(screen.getByLabelText("일정 날짜")).toHaveValue("2026-11-13");

    fireEvent.click(screen.getByRole("button", { name: "일정 만들기" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts).toEqual([
      { url: "/api/notes", body: { kind: "note", body: "은행 방문\n신분증 챙기기", noteDate: "2026-11-13", addedBy: "web" } },
      { url: "/api/notes/5/event", body: { title: "은행 방문", start: "2026-11-13T11:00:00+09:00", end: "2026-11-13T11:30:00+09:00" } }
    ]);
  });

  it("does not offer task or event when editing a saved note", async () => {
    stubFetch(() => json({ targets: [] }));
    render(<NoteFlow note={note()} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    expect(screen.queryByRole("group", { name: "무엇으로 남길까요?" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("goes back to the text from the attach step without losing choices", async () => {
    stubFetch(() => json({ targets: [THREAD] }));
    render(<NoteFlow defaultDate="2026-11-12" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "첫 줄" } });
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(await screen.findByRole("button", { name: /졸업 프로젝트/ }));
    fireEvent.click(screen.getByRole("button", { name: "← 내용 고치기" }));
    expect(screen.getByLabelText("1번째 줄")).toHaveValue("첫 줄");
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    expect(screen.getByRole("list", { name: "붙인 곳" })).toHaveTextContent("졸업 프로젝트");
  });

  it("saves a multi-line note in one tap with the date it was opened for", async () => {
    const posts: unknown[] = [];
    stubFetch((_url, init) => {
      if (init?.method === "POST") posts.push(JSON.parse(String(init.body)));
      return json({ note: note() });
    });
    render(<NoteFlow defaultDate="2026-11-12" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "첫 줄\n\n둘째 줄" } });
    fireEvent.click(screen.getByRole("button", { name: "오늘로 바로 저장" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ kind: "note", body: "첫 줄\n둘째 줄", noteDate: "2026-11-12", addedBy: "web" });
  });
});

describe("note cards", () => {
  it("toggles a checklist item and keeps item ids when the list is edited", async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    stubFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/items/11")) {
        return json({ note: { ...CHECKLIST, items: CHECKLIST.items.map((i) => (i.id === 11 ? { ...i, done: true } : i)) } });
      }
      if (init?.method === "PATCH") return json({ note: CHECKLIST });
      return json({ notes: [CHECKLIST], total: 1, related: [] });
    });
    const target = { targetType: "event" as const, targetId: 7, label: "지도교수 면담", when: null, status: null, exists: true };
    render(<AttachedNotes target={target} initial={[CHECKLIST]} />);

    // 이미 받은 목록이 있으면 처음엔 요청하지 않는다. 이 일정에 붙은 메모라 일정 칩도 다시 보여주지 않는다.
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /지도교수 면담/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "슬라이드" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "슬라이드" })).toBeChecked());
    expect(calls[0]).toMatchObject({ url: "/api/notes/2/items/11", method: "PATCH", body: { done: true } });

    // 고치기는 같은 전체 화면 흐름을 연다. 항목은 id 를 그대로 들고 간다.
    fireEvent.click(screen.getByRole("button", { name: "고치기" }));
    const dialog = screen.getByRole("dialog", { name: "메모 고치기" });
    expect(within(dialog).getByRole("checkbox", { name: "1번째 항목 완료" })).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("1번째 줄"), { target: { value: "슬라이드 최종본" } });
    fireEvent.change(within(dialog).getByLabelText("2번째 줄"), { target: { value: "질문 목록\n노트북 충전" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "바로 저장" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/notes/2" && c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.url === "/api/notes/2" && c.method === "PATCH")!;
    expect(patch.body).toEqual({
      kind: "checklist",
      title: "면담 준비",
      body: null,
      items: [{ id: 11, text: "슬라이드 최종본", done: true }, { id: 12, text: "질문 목록", done: true }, { text: "노트북 충전", done: false }],
      noteDate: "2026-03-12",
      links: [{ targetType: "event", targetId: 7 }],
      remoteVisible: false
    });
  });

  it("shows which notes are shared with remote AI and flips it from the card", async () => {
    const patches: unknown[] = [];
    stubFetch((_url, init) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return json({ note: note({ remoteVisible: true }) });
      }
      return json({ notes: [note({ remoteVisible: true })], total: 1, related: [] });
    });
    render(<AttachedNotes date="2026-03-12" initial={[note()]} />);
    expect(screen.queryByText("AI 공개", { selector: ".note-badge" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 공개" }));
    expect(await screen.findByText("AI 공개", { selector: ".note-badge" })).toBeInTheDocument();
    expect(patches).toEqual([{ remoteVisible: true }]);
    expect(screen.getByRole("button", { name: "AI 비공개로" })).toHaveAttribute("aria-pressed", "true");
  });

  it("turns a note into an event: AI reads the time, the user confirms or corrects it", async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    const linked = note({ links: [{ targetType: "event", targetId: 40, label: "치과 정기검진", when: "2026-11-20T15:30:00+09:00", status: "planned", exists: true }] });
    stubFetch((url, init) => {
      if (url === "/api/notes/1/event-draft") {
        return json({ title: "치과 정기검진", start: "2026-11-20T15:00:00+09:00", end: "2026-11-20T16:00:00+09:00", parseStatus: "parsed" });
      }
      if (url === "/api/notes/1/event") {
        posts.push({ url, body: JSON.parse(String(init?.body)) });
        return json({ note: linked, eventId: 40 });
      }
      return json({ notes: [linked], total: 1, related: [] });
    });
    render(<AttachedNotes date="2026-03-12" initial={[note()]} />);

    // 변환은 카드가 아니라 고치기 화면 안에 있다.
    expect(screen.queryByRole("button", { name: /일정으로/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고치기" }));
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(screen.getByRole("button", { name: "일정으로 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "메모를 일정으로" });
    expect(within(dialog).getByText("메모에서 날짜와 시간을 읽는 중…")).toBeInTheDocument();
    expect(await within(dialog).findByText("메모에서 읽은 값입니다. 맞는지 확인하고 고치세요.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("일정 제목")).toHaveValue("치과 정기검진");
    expect(within(dialog).getByLabelText("일정 날짜")).toHaveValue("2026-11-20");
    expect(within(dialog).getByLabelText("시작 시간")).toHaveValue("15:00");
    expect(posts).toHaveLength(0); // 확인 전에는 아무것도 만들지 않는다

    fireEvent.change(within(dialog).getByLabelText("시작 시간"), { target: { value: "15:30" } });
    fireEvent.change(within(dialog).getByLabelText("끝 시간"), { target: { value: "15:00" } });
    expect(within(dialog).getByRole("button", { name: "일정 만들기" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("끝 시간"), { target: { value: "16:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "일정 만들기" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "메모를 일정으로" })).not.toBeInTheDocument());
    expect(posts).toEqual([{ url: "/api/notes/1/event", body: { title: "치과 정기검진", start: "2026-11-20T15:30:00+09:00", end: "2026-11-20T16:30:00+09:00" } }]);
    expect(await screen.findByRole("link", { name: /치과 정기검진/ })).toBeInTheDocument();
  });

  it("lets the user pick the date by hand when AI could not read one", async () => {
    stubFetch((url) => (url.endsWith("/event-draft")
      ? json({ title: "평가 기준은 재현성 위주", start: null, end: null, parseStatus: "unparsed", llmError: "unavailable" })
      : json({ notes: [], total: 0, related: [] })));
    render(<AttachedNotes date="2026-03-12" initial={[note()]} />);
    // 변환은 카드가 아니라 고치기 화면 안에 있다.
    expect(screen.queryByRole("button", { name: /일정으로/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고치기" }));
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    fireEvent.click(screen.getByRole("button", { name: "일정으로 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "메모를 일정으로" });
    expect(await within(dialog).findByText("날짜를 읽지 못했습니다. 직접 선택하세요.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("일정 날짜")).toHaveValue("2026-03-12"); // 메모 날짜에서 시작
    expect(within(dialog).getByLabelText("시작 시간")).toHaveValue("09:00");
    expect(within(dialog).getByRole("button", { name: "일정 만들기" })).toBeEnabled();
  });

  it("makes a task from one checklist item and marks it", async () => {
    const calls: string[] = [];
    const after = { ...CHECKLIST, items: CHECKLIST.items.map((i) => (i.id === 11 ? { ...i, taskId: 77 } : i)) };
    stubFetch((url, init) => {
      if (init?.method === "POST") {
        calls.push(url);
        return json({ note: after, taskId: 77 });
      }
      return json({ notes: [after], total: 1, related: [] });
    });
    render(<AttachedNotes date="2026-03-12" initial={[CHECKLIST]} />);
    // 카드에는 변환 버튼이 없다. 고치기 화면의 2단계에서 항목별로 고른다.
    expect(screen.queryByRole("button", { name: /할 일로 만들기/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "고치기" }));
    fireEvent.click(screen.getByRole("button", { name: "다음: 붙일 곳 →" }));
    const group = screen.getByRole("group", { name: "이 메모로 만들기" });
    fireEvent.click(within(group).getByRole("button", { name: "슬라이드 할 일로 만들기" }));
    await waitFor(() => expect(within(group).queryByRole("button", { name: "슬라이드 할 일로 만들기" })).not.toBeInTheDocument());
    expect(calls).toEqual(["/api/notes/2/items/11/task"]);
    expect(within(group).getByText("할 일", { selector: ".note-badge" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "질문 목록 할 일로 만들기" })).toBeInTheDocument();
  });

  it("asks twice before deleting", async () => {
    const fetchMock = stubFetch((_url, init) => (init?.method === "DELETE" ? json({ deleted: 1 }) : json({ notes: [], total: 0, related: [] })));
    render(<AttachedNotes date="2026-03-12" initial={[note()]} />);
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "정말 지우기" }));
    await waitFor(() => expect(screen.queryByText("평가 기준은 재현성 위주")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });
  });

  it("writes a note onto the place it is opened from", async () => {
    const posts: unknown[] = [];
    stubFetch((_url, init) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({ note: note({ id: 3, body: "발표 15분" }) });
      }
      return json({ notes: [note({ id: 3, body: "발표 15분" })], total: 1, related: [] });
    });
    const target = { targetType: "task" as const, targetId: 4, label: "중간 보고서", when: null, status: "todo", exists: true };
    render(<AttachedNotes target={target} initial={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument(); // 빈 곳에는 추가 버튼만 있다

    fireEvent.click(screen.getByRole("button", { name: "+ 메모" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "발표 15분" } });
    fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));

    // 입력창(textarea)도 같은 글자를 담고 있어서, 저장된 카드로 확인한다.
    expect(within(await screen.findByTestId("note-3")).getByText("발표 15분")).toBeInTheDocument();
    expect(screen.queryByLabelText("1번째 줄")).not.toBeInTheDocument();
    expect(posts[0]).toMatchObject({ kind: "note", body: "발표 15분", links: [{ targetType: "task", targetId: 4 }] });
    expect(posts[0]).not.toHaveProperty("noteDate");
  });
});

describe("AppNav", () => {
  it("opens the quick note sheet from any screen and closes it with Escape", async () => {
    stubFetch(() => json([]));
    render(<AppNav path="/threads" />);
    expect(screen.getByRole("link", { name: "메모" })).toHaveAttribute("href", "/notes");
    expect(screen.getByRole("link", { name: "스레드" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "빠른 기록 쓰기" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 기록" });
    expect(within(dialog).getByLabelText("1번째 줄")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 기록" })).not.toBeInTheDocument());
  });

  it("cycles and remembers the theme", () => {
    stubFetch(() => json([]));
    render(<AppNav path="/today" />);
    fireEvent.click(screen.getByRole("button", { name: "테마 바꾸기 (지금: 시스템)" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("cairn.theme")).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "테마 바꾸기 (지금: 라이트)" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: "테마 바꾸기 (지금: 다크)" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem("cairn.theme")).toBeNull();
  });

  it("marks 더보기 when the current page lives behind it", () => {
    stubFetch(() => json([]));
    render(<AppNav path="/mirror" />);
    const more = screen.getByRole("button", { name: "더보기" });
    expect(more).toHaveAttribute("data-active", "true");
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toHaveAttribute("data-more", "open");
  });
});
