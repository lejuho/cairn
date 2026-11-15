import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AgentArtifact, AgentChatData, AgentMessage, AgentProviderInfo, AgentSources, EventCandidate } from "@cairn/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "./AgentPanel.js";
import { DATA_CHANGED_EVENT } from "./api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const PROVIDERS: AgentProviderInfo[] = [
  { id: "anthropic", label: "Anthropic", available: true, via: "claude CLI (구독)", models: [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }, { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" }], defaultModel: "claude-opus-5-5", allowCustomModel: true },
  { id: "openai", label: "OpenAI", available: true, via: "codex CLI (구독)", models: [{ id: "", label: "codex 기본 (gpt-6-astra)" }], defaultModel: "", allowCustomModel: true },
  { id: "xai", label: "xAI Grok", available: false, via: "Grok 프록시", models: [{ id: "grok", label: "grok" }], defaultModel: "grok", allowCustomModel: true }
];

const NO_SOURCES: AgentSources = { mail: { configured: false, connected: false }, sheets: { connected: false, list: [] }, reason: { available: false, session: "", unread: 0 }, candidates: 0 };

type AgentReply = Extract<AgentMessage, { role: "agent" }>;

function agentMessage(over: Partial<AgentReply> = {}): AgentReply {
  return { id: 11, role: "agent", text: "네.", steps: [], pending: [], via: "Anthropic · claude-opus-5-5", createdAt: "2026-11-13T03:00:00.000Z", ...over };
}

function chatData(over: Partial<AgentChatData> = {}): AgentChatData {
  return { conversationId: 5, message: agentMessage(), artifacts: [], changed: false, ...over };
}

const TASK: AgentArtifact = { targetType: "task", targetId: 9, label: "파일럿 계획 쓰기", when: "2026-11-20", status: "todo", lastAction: "생성", exists: true, link: "/notes?targetType=task&targetId=9" };
const EVENT: AgentArtifact = { targetType: "event", targetId: 4, label: "면담", when: "2026-11-21T10:00:00+09:00", status: "planned", lastAction: "시간 변경", exists: true, link: "/calendar?date=2026-11-21" };
const GONE: AgentArtifact = { targetType: "note", targetId: 2, label: "지운 메모", when: null, status: null, lastAction: "삭제", exists: false, link: "/notes" };

function json(data: unknown, ok = true) {
  return { ok: true, status: 200, redirected: false, url: "", json: () => Promise.resolve(ok ? { ok: true, data } : { ok: false, error: { message: String(data) } }) };
}

// An event-stream response, the way the real server answers a browser.
function stream(events: unknown[]) {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true, status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/event-stream; charset=utf-8" : null) },
    body: { getReader: () => ({ read: () => Promise.resolve(sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })) }) }
  };
}

type Call = { url: string; method: string; body: Record<string, unknown> };

function stub(handler: (call: Call) => unknown, extra: { sources?: AgentSources | (() => AgentSources); candidates?: EventCandidate[] | (() => EventCandidate[]) } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (String(url) === "/api/agent/providers") return Promise.resolve(json({ providers: PROVIDERS }));
    // Tests that care about sources or candidates stub them through `extra`.
    if (String(url) === "/api/agent/sources" && !extra.sources) return Promise.resolve(json(NO_SOURCES));
    if (String(url) === "/api/agent/sources") return Promise.resolve(json(typeof extra.sources === "function" ? extra.sources() : extra.sources));
    if (String(url) === "/api/inbox/candidates") return Promise.resolve(json({ candidates: typeof extra.candidates === "function" ? extra.candidates() : extra.candidates ?? [] }));
    const call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {} };
    calls.push(call);
    return Promise.resolve(handler(call));
  }));
  return calls;
}

function say(text: string) {
  fireEvent.change(screen.getByLabelText("에이전트에게 할 말"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
}

describe("AgentPanel", () => {
  it("sends what was said with the chosen provider and model, and lists what was applied", async () => {
    const changed = vi.fn();
    window.addEventListener(DATA_CHANGED_EVENT, changed);
    const calls = stub(() => json(chatData({
      changed: true, artifacts: [TASK],
      message: agentMessage({ text: "할 일을 추가했습니다.", via: "Anthropic · claude-haiku-5-5", steps: [{ tool: "create_task", ok: true, summary: "할 일 생성: 파일럿 계획 쓰기", link: "/threads/2" }] })
    })));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    expect(screen.getByRole("button", { name: "xAI Grok" })).toBeDisabled(); // 이 서버에서 못 쓰는 것
    expect(screen.getByRole("switch", { name: "비공개 메모까지 읽기" })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "claude-haiku-5-5" } });
    say("파일럿 계획 쓰기를 20일까지로 넣어줘");

    const reply = await screen.findByText("할 일을 추가했습니다.");
    const bubble = reply.closest(".agent-msg") as HTMLElement;
    expect(within(bubble).getByRole("list", { name: "반영한 것" })).toHaveTextContent("할 일 생성: 파일럿 계획 쓰기");
    expect(within(bubble).getByRole("link", { name: "보기" })).toHaveAttribute("href", "/threads/2");
    expect(within(bubble).getByText("Anthropic · claude-haiku-5-5")).toBeInTheDocument();
    expect(calls[0]).toEqual({
      url: "/api/agent/chat", method: "POST",
      body: { provider: "anthropic", model: "claude-haiku-5-5", includePrivate: false, includeMail: false, includeSheets: false, includeFiles: false, text: "파일럿 계획 쓰기를 20일까지로 넣어줘" }
    });
    expect(changed).toHaveBeenCalledTimes(1); // 열려 있는 화면이 다시 불러오도록 알린다
    window.removeEventListener(DATA_CHANGED_EVENT, changed);

    // 이어서 말하면 같은 대화로 보낸다.
    say("고마워");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body).toMatchObject({ conversationId: 5, text: "고마워" });
  });

  it("shows progress while the answer is being made", async () => {
    let release: (value: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url) === "/api/agent/providers") return Promise.resolve(json({ providers: PROVIDERS }));
      if (String(url) === "/api/agent/sources") return Promise.resolve(json(NO_SOURCES));
      if (String(url) === "/api/inbox/candidates") return Promise.resolve(json({ candidates: [] }));
      return new Promise((resolve) => { release = resolve; });
    }));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    say("할 일 하나 추가");

    // 기다리는 동안: 내가 한 말은 바로 보이고, 진행 상태가 뜬다.
    expect(screen.getByText("할 일 하나 추가")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "답을 만드는 중" })).toHaveTextContent("보내는 중…");
    expect(screen.getByLabelText("에이전트에게 할 말")).toBeDisabled();

    release(stream([
      { type: "status", text: "모델에 묻는 중…" },
      { type: "say", text: "추가할게요." },
      { type: "step", step: { tool: "create_task", ok: true, summary: "할 일 생성: 스트림 테스트" } },
      { type: "done", data: chatData({ changed: true, message: agentMessage({ text: "추가했습니다.", steps: [{ tool: "create_task", ok: true, summary: "할 일 생성: 스트림 테스트" }] }) }) }
    ]));
    expect(await screen.findByText("추가했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "답을 만드는 중" })).not.toBeInTheDocument();
    expect(screen.getAllByText("할 일 생성: 스트림 테스트")).toHaveLength(1); // 진행 중 표시가 최종 답으로 바뀐다
  });

  it("asks before removals and edits, shows what will change, and carries out only what is approved", async () => {
    const calls = stub((call) => (call.url === "/api/agent/confirm"
      ? json({ step: { tool: "x", ok: true, summary: call.body.approve ? "일정 수정: 면담" : "하지 않음: 할 일 드롭: 안 할 일" }, changed: call.body.approve, conversationId: 5, artifacts: call.body.approve ? [EVENT] : [] })
      : json(chatData({ message: agentMessage({
          text: "승인해 주세요.",
          pending: [
            { id: "p1", tool: "update_event", summary: "일정 수정: 면담", detail: "시작 → 2026-11-21 10:00\n끝 → 2026-11-21 11:00", state: "waiting" },
            { id: "p2", tool: "drop_task", summary: "할 일 드롭: 안 할 일", state: "waiting" }
          ]
        }) }))));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    say("면담은 토요일 10시로 옮기고 안 할 일은 드롭해");

    const edit = await screen.findByRole("group", { name: "승인 필요: 일정 수정: 면담" });
    expect(edit).toHaveTextContent("시작 → 2026-11-21 10:00");
    fireEvent.click(within(edit).getByRole("button", { name: "승인" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "승인 필요: 일정 수정: 면담" })).not.toBeInTheDocument());
    expect(screen.getByRole("list", { name: "반영한 것" })).toHaveTextContent("일정 수정: 면담");
    expect(screen.getByRole("tab", { name: /다룬 항목\s*1/ })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "승인 필요: 할 일 드롭: 안 할 일" })).getByRole("button", { name: "하지 않음" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: /승인 필요/ })).not.toBeInTheDocument());
    expect(calls.filter((c) => c.url === "/api/agent/confirm").map((c) => c.body)).toEqual([{ id: "p1", approve: true }, { id: "p2", approve: false }]);
  });

  it("collects what the conversation touched, grouped by kind, with links to open them", async () => {
    stub(() => json(chatData({ artifacts: [TASK, EVENT, GONE] })));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    say("정리해줘");
    fireEvent.click(await screen.findByRole("tab", { name: /다룬 항목\s*3/ }));

    const panel = screen.getByRole("tabpanel", { name: "다룬 항목" });
    const events = within(panel).getByRole("region", { name: "일정" });
    expect(events).toHaveTextContent("면담");
    expect(events).toHaveTextContent("11/21 10:00 · planned · 이 대화에서: 시간 변경");
    expect(within(events).getByRole("link", { name: "열기" })).toHaveAttribute("href", "/calendar?date=2026-11-21");
    expect(within(panel).getByRole("region", { name: "할 일" })).toHaveTextContent("파일럿 계획 쓰기");
    // 지워진 것은 남기되 열 수 없다.
    const notes = within(panel).getByRole("region", { name: "메모" });
    expect(notes).toHaveTextContent("지워짐 · 이 대화에서: 삭제");
    expect(within(notes).queryByRole("link")).not.toBeInTheDocument();
  });

  it("comes back to the last conversation, lists earlier ones and can start a new one", async () => {
    window.localStorage.setItem("cairn.agent", JSON.stringify({ provider: "openai", model: "", includePrivate: true, conversationId: 5 }));
    const stored = {
      conversation: { id: 5, title: "초안 쓰기 추가해줘", provider: "openai", model: "", updatedAt: "2026-11-13T03:00:00.000Z" },
      messages: [{ id: 1, role: "user", text: "초안 쓰기 추가해줘", createdAt: "2026-11-13T03:00:00.000Z" }, agentMessage({ id: 2, text: "추가했습니다." })],
      artifacts: [TASK]
    };
    const calls = stub((call) => {
      if (call.url === "/api/agent/conversations/5" && call.method === "GET") return json(stored);
      if (call.url === "/api/agent/conversations/7") return json({ ...stored, conversation: { ...stored.conversation, id: 7 }, messages: [{ id: 3, role: "user", text: "다른 대화", createdAt: "2026-11-12T03:00:00.000Z" }], artifacts: [] });
      if (call.url === "/api/agent/conversations" ) return json({ conversations: [stored.conversation, { id: 7, title: "다른 대화", provider: "anthropic", model: "claude-opus-5-5", updatedAt: "2026-11-12T03:00:00.000Z" }] });
      if (call.method === "DELETE") return json({ deleted: 7 });
      return json(chatData({ conversationId: 9 }));
    });
    render(<AgentPanel onClose={() => undefined} />);

    // 탭을 닫았다 열어도 대화와 선택이 그대로다.
    expect(await screen.findByText("추가했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OpenAI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "비공개 메모까지 읽기" })).toBeChecked();
    expect(screen.getByRole("tab", { name: /다룬 항목\s*1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "지난 대화" }));
    fireEvent.click(await screen.findByRole("button", { name: "다른 대화 열기" }));
    expect(await screen.findByText("다른 대화")).toBeInTheDocument();
    expect(screen.queryByText("추가했습니다.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "지난 대화" }));
    fireEvent.click(await screen.findByRole("button", { name: "다른 대화 대화 지우기" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/agent/conversations/7")).toBe(true));

    // 새 대화는 대화 번호 없이 보낸다.
    fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
    say("새로 시작");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/agent/chat")).toBe(true));
    expect(calls.find((c) => c.url === "/api/agent/chat")!.body).toEqual({ provider: "openai", model: "", includePrivate: true, includeMail: false, includeSheets: false, includeFiles: false, text: "새로 시작" });
  });

  it("connects mail by pasting the address back, then reads mail only while the switch is on", async () => {
    let connected = false;
    const calls = stub((call) => {
      if (call.url === "/api/agent/mail/auth-url") return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
      if (call.url === "/api/agent/mail/connect") {
        connected = true;
        return json({ connected: true });
      }
      return json(chatData());
    }, { sources: () => ({ mail: { configured: true, connected }, sheets: { connected: false, list: [] }, reason: { available: true, session: "cairn", unread: 2 }, candidates: 0 }) });
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });

    expect(await screen.findByText(/Reason Network 이름 "cairn" · 안 읽은 메시지 2건/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "메일 읽기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Google 연결" }));
    expect(await screen.findByRole("link", { name: "구글 승인 화면 열기" })).toHaveAttribute("href", "https://accounts.google.com/o/oauth2/v2/auth?x=1");
    fireEvent.change(screen.getByLabelText("승인 뒤 이동한 주소"), { target: { value: "http://localhost:3456/?code=4/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/agent/mail/connect")?.body).toEqual({ code: "http://localhost:3456/?code=4/abc" }));

    // 연결되면 스위치가 켜진 채로 나타나고, 그때부터 메일 읽기가 요청에 실린다.
    expect(await screen.findByRole("switch", { name: "메일 읽기" })).toBeChecked();
    say("이번 주 메일에서 일정 찾아줘");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/agent/chat")).toBe(true));
    expect(calls.find((c) => c.url === "/api/agent/chat")!.body).toMatchObject({ includeMail: true });

    fireEvent.click(screen.getByRole("switch", { name: "메일 읽기" }));
    await screen.findByText("네.");
    say("다시");
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/agent/chat")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/api/agent/chat")[1]!.body).toMatchObject({ includeMail: false });
  });

  it("registers the sheets it may read, and approves several things at once", async () => {
    const SHEET = { id: 1, name: "위클리 액션", url: "https://docs.google.com/spreadsheets/d/abc" };
    let registered: Array<typeof SHEET> = [];
    const pending = [
      { id: "p1", tool: "create_task", summary: "할 일 생성: 데모 영상 녹화", state: "waiting" as const },
      { id: "p2", tool: "create_task", summary: "할 일 생성: 회고 쓰기", state: "waiting" as const }
    ];
    const calls = stub((call) => {
      if (call.url === "/api/agent/sheets") return json({ sheets: (registered = [SHEET]) });
      if (call.url === "/api/agent/sheets/1") return json({ sheets: (registered = []) });
      if (call.url === "/api/agent/confirm") return json({ step: { tool: "create_task", ok: true, summary: `승인됨 ${String(call.body.id)}` }, changed: true, artifacts: [] });
      return json(chatData({ message: agentMessage({ text: "2건을 승인해 주세요.", pending }) }));
    }, { sources: () => ({ mail: { configured: true, connected: true }, sheets: { connected: true, list: registered }, reason: { available: false, session: "", unread: 0 }, candidates: 0 }) });
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });

    fireEvent.change(await screen.findByLabelText("추가할 스프레드시트 주소"), { target: { value: "https://docs.google.com/spreadsheets/d/abc/edit" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(await screen.findByRole("link", { name: "위클리 액션" })).toHaveAttribute("href", SHEET.url);
    expect(calls.find((c) => c.url === "/api/agent/sheets")!.body).toEqual({ url: "https://docs.google.com/spreadsheets/d/abc/edit" });

    say("위클리 액션에서 내 할 일 넣어줘");
    fireEvent.click(await screen.findByRole("button", { name: "2건 모두 승인" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/agent/confirm").map((c) => c.body)).toEqual([{ id: "p1", approve: true }, { id: "p2", approve: true }]));
    expect(await screen.findByText("승인됨 p2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "위클리 액션 시트 빼기" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "위클리 액션" })).not.toBeInTheDocument());
  });

  it("chooses what the agent may read with one row of chips", async () => {
    const calls = stub(() => json(chatData()), { sources: { mail: { configured: true, connected: true }, sheets: { connected: true, list: [{ id: 1, name: "위클리", url: "https://docs.google.com/spreadsheets/d/x" }] }, reason: { available: false, session: "", unread: 0 }, candidates: 0 } });
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    const scope = screen.getByRole("group", { name: "에이전트가 읽을 범위" });

    // 시트는 등록돼 있으면 켜진 채로, 나머지는 꺼진 채로 시작한다.
    expect(await within(scope).findByRole("switch", { name: "시트 읽기" })).toBeChecked();
    expect(within(scope).getByRole("switch", { name: "메일 읽기" })).not.toBeChecked();
    expect(within(scope).getByRole("switch", { name: "파일 내용 읽기" })).not.toBeChecked();
    expect(screen.getByText("등록한 시트를 읽습니다 (읽기 전용). 읽은 내용은 Anthropic로 전송됩니다.")).toBeInTheDocument();

    fireEvent.click(within(scope).getByRole("switch", { name: "파일 내용 읽기" }));
    fireEvent.click(within(scope).getByRole("switch", { name: "시트 읽기" }));
    fireEvent.click(within(scope).getByRole("switch", { name: "비공개 메모까지 읽기" }));
    say("회의 자료 요약해줘");
    await waitFor(() => expect(calls.some((c) => c.url === "/api/agent/chat")).toBe(true));
    expect(calls.find((c) => c.url === "/api/agent/chat")!.body).toMatchObject({ includePrivate: true, includeMail: false, includeSheets: false, includeFiles: true });
  });

  it("sends picked files with the message so the agent can put them on a note", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/agent/providers") return Promise.resolve(json({ providers: PROVIDERS }));
      if (u === "/api/agent/sources") return Promise.resolve(json(NO_SOURCES));
      if (u === "/api/inbox/candidates") return Promise.resolve(json({ candidates: [] }));
      calls.push({ url: u, body: init?.body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u === "/api/agent/uploads") return Promise.resolve(json({ fileId: 40 + calls.length, name: "x", mime: "application/pdf", size: 3 }));
      return Promise.resolve(json(chatData({ message: agentMessage({ text: "온보딩 메모에 붙였습니다.", steps: [{ tool: "attach_file", ok: true, summary: "파일 붙임: 슬라이드.pdf → 온보딩 콜 자료", link: "/notes" }] }), changed: true })));
    }));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });

    const slides = new File(["pdf"], "슬라이드.pdf", { type: "application/pdf" });
    const huge = new File(["x"], "녹화본.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: 60 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId("agent-file-input"), { target: { files: [slides, huge] } });
    expect(screen.getByRole("alert")).toHaveTextContent("50MB를 넘는 파일은 올릴 수 없습니다");
    expect(screen.getByRole("list", { name: "보낼 파일" })).toHaveTextContent("슬라이드.pdf");
    expect(screen.getByRole("list", { name: "보낼 파일" })).not.toHaveTextContent("녹화본.mp4");

    // 글 없이 파일만으로도 보낼 수 있다.
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("파일 붙임: 슬라이드.pdf → 온보딩 콜 자료")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ url: "/api/agent/uploads", headers: { "x-file-name": encodeURIComponent("슬라이드.pdf") } });
    expect(calls[0]!.body).toBe(slides);
    expect(JSON.parse(String(calls[1]!.body))).toMatchObject({ uploads: [41], text: "올린 파일을 메모에 정리해 주세요.\n[첨부: 슬라이드.pdf]" });
    expect(screen.queryByRole("list", { name: "보낼 파일" })).not.toBeInTheDocument();
  });

  it("lists found events as candidates and puts one on the calendar only when chosen", async () => {
    let list: EventCandidate[] = [{
      id: 31, title: "3월 독서 모임", start: "2027-03-12T19:00:00+09:00", end: null, location: "합정역", online: false, url: null,
      origin: "gmail", proposedBy: "cairn-agent", note: "출처: 메일: 3월 독서 모임 안내", verdict: "tight", reasons: ["앞 일정과 30분 간격입니다."], createdAt: "2026-11-13T03:00:00.000Z"
    }];
    const calls = stub((call) => {
      if (call.url === "/api/inbox/31/answer") {
        list = [];
        return json({ id: 31, status: "answered", effect: { createdEventId: 8 } });
      }
      return json(chatData());
    }, { candidates: () => list });
    const changed = vi.fn();
    window.addEventListener(DATA_CHANGED_EVENT, changed);
    render(<AgentPanel onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole("tab", { name: /후보\s*1/ }));
    const panel = screen.getByRole("tabpanel", { name: "일정 후보" });
    expect(within(panel).getByText("3월 독서 모임")).toBeInTheDocument();
    expect(within(panel).getByText("출처: 메일 · 3월 독서 모임 안내")).toBeInTheDocument();
    expect(within(panel).getByText("빠듯함")).toBeInTheDocument();
    expect(within(panel).getByText("앞 일정과 30분 간격입니다.")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "3월 독서 모임 일정에 넣기" }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/inbox/31/answer")?.body).toEqual({ decision: "accept", answeredBy: "web" }));
    await waitFor(() => expect(screen.queryByText("3월 독서 모임")).not.toBeInTheDocument());
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(DATA_CHANGED_EVENT, changed);
  });

  it("shows the provider's error and keeps the conversation usable", async () => {
    stub(() => json("응답 시간이 초과됐습니다", false));
    render(<AgentPanel onClose={() => undefined} />);
    await screen.findByRole("button", { name: "Anthropic" });
    say("안녕");
    expect(await screen.findByRole("alert")).toHaveTextContent("응답 시간이 초과됐습니다");
    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByLabelText("에이전트에게 할 말")).toBeEnabled();
  });
});
