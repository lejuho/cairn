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
    { id: 11, text: "슬라이드", done: false, doneAt: null, position: 0 },
    { id: 12, text: "질문 목록", done: true, doneAt: "2026-03-11T01:00:00.000Z", position: 1 }
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

  it("shows the empty state when there are no notes", async () => {
    stubFetch(() => json({ notes: [], total: 0, related: [] }));
    render(<NotesPage />);
    expect(await screen.findByText("아직 메모가 없어")).toBeInTheDocument();
  });

  it("shows an error with a retry that recovers", async () => {
    let fail = true;
    stubFetch(() => (fail ? json("DB 잠김", false) : json({ notes: [note()], total: 1, related: [] })));
    render(<NotesPage />);
    expect(await screen.findByText("메모를 불러오지 못했어")).toBeInTheDocument();
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
    await screen.findByText("이 조건에 맞는 메모가 없어");
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
    await screen.findByText("아직 메모가 없어");
    fireEvent.click(screen.getByRole("button", { name: "+ 새 메모" }));
    fireEvent.change(screen.getByLabelText("1번째 줄"), { target: { value: "잃으면 안 되는 글" } });
    fireEvent.click(screen.getByRole("button", { name: "오늘로 바로 저장" }));
    expect(await screen.findByText("저장 실패")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "빠른 메모" })).toBeInTheDocument();
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
    expect(screen.getByText("꺼져 있으면 이 기기와 Pi 안에서만 보여.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("원격 AI가 이 메모를 읽을 수 있어.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "저장 (11/12 · AI 공개)" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ body: "공유해도 되는 것", remoteVisible: true });
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
    expect(screen.getByText("아직 붙여둔 메모가 없어.")).toBeInTheDocument();

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

    fireEvent.click(screen.getByRole("button", { name: "빠른 메모 쓰기" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 메모" });
    expect(within(dialog).getByLabelText("1번째 줄")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 메모" })).not.toBeInTheDocument());
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
