import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AgentArtifact,
  AgentChatData,
  AgentConversationData,
  AgentConversationSummary,
  AgentMessage,
  AgentProvider,
  AgentProviderInfo,
  AgentSheet,
  AgentSources,
  AgentStep,
  AgentStreamEvent
} from "@cairn/shared";
import { apiJson, DATA_CHANGED_EVENT } from "./api.js";
import { CandidateList, useCandidates } from "./Candidates.js";
import { NOTES_CHANGED_EVENT } from "./Notes.js";

// The in-app agent: pick a provider and model, say what you want, and it is applied to Cairn.
// Additions and links happen at once and are listed under the reply; removals and edits wait for
// approval. Conversations are kept on the server, and each one collects the things it touched.

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

type Settings = { provider: AgentProvider; model: string; includePrivate: boolean; includeMail: boolean; conversationId: number | null };
type Tab = "chat" | "candidates" | "items" | "history";
// What is shown while an answer is being made.
type Live = { status: string; say: string; steps: AgentStep[] };

const SETTINGS_KEY = "cairn.agent";
const DEFAULT_SETTINGS: Settings = { provider: "anthropic", model: "", includePrivate: false, includeMail: false, conversationId: null };
const TYPE_LABEL: Record<AgentArtifact["targetType"], string> = { event: "일정", task: "할 일", thread: "스레드", note: "메모" };
const TYPE_ORDER: Array<AgentArtifact["targetType"]> = ["event", "task", "thread", "note"];

function readSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function announce(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
}

function message(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return fallback;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiJson<ApiResponse<T>>(url, init);
  if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || "요청을 처리하지 못했습니다");
  return res.data;
}

function shortWhen(value: string | null): string {
  if (!value) return "";
  const [date, time] = [value.slice(0, 10), value.slice(11, 16)];
  const [, m, d] = date.split("-");
  if (!m || !d) return "";
  return `${Number(m)}/${Number(d)}${time && time !== "00:00" ? ` ${time}` : ""}`;
}

// Sends one message. The server streams progress when it can; otherwise the answer arrives whole.
async function sendChat(body: unknown, onEvent: (event: AgentStreamEvent) => void): Promise<AgentChatData> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body)
  });
  const type = res.headers?.get?.("content-type") ?? "";
  if (!type.includes("text/event-stream") || !res.body) {
    let parsed: ApiResponse<AgentChatData> | null = null;
    try {
      parsed = (await res.json()) as ApiResponse<AgentChatData>;
    } catch {
      throw new Error("로그인 세션이 만료됐거나 네트워크가 끊겼습니다");
    }
    if (!parsed || parsed.ok !== true) throw new Error((parsed && !parsed.ok && parsed.error?.message) || "답을 받지 못했습니다");
    return parsed.data;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: AgentChatData | null = null;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const line = buffer.slice(0, cut).replace(/^data: /, "");
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      if (!line.trim()) continue;
      const event = JSON.parse(line) as AgentStreamEvent;
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") done = event.data;
      else onEvent(event);
    }
  }
  if (!done) throw new Error("답이 중간에 끊겼습니다");
  return done;
}

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<AgentProviderInfo[] | null>(null);
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [customModel, setCustomModel] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [history, setHistory] = useState<AgentConversationSummary[] | null>(null);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<AgentSources | null>(null);
  // Connecting mail: the Google address to open, and the address the user pastes back.
  const [connect, setConnect] = useState<{ url: string; pasted: string; working: boolean; error: string | null } | null>(null);
  const { candidates } = useCandidates();
  const logRef = useRef<HTMLDivElement>(null);
  const busy = live !== null;
  const conversationId = settings.conversationId;

  useEffect(() => {
    let alive = true;
    call<{ providers: AgentProviderInfo[] }>("/api/agent/providers")
      .then((data) => {
        if (!alive) return;
        setProviders(data.providers);
        // Fall back to something usable if the remembered provider is not available here.
        setSettings((s) => {
          if (data.providers.find((p) => p.id === s.provider)?.available) return s;
          const usable = data.providers.find((p) => p.available);
          return usable ? { ...s, provider: usable.id, model: usable.defaultModel } : s;
        });
      })
      .catch(() => alive && setProviders([]));
    return () => {
      alive = false;
    };
  }, []);

  const loadSources = useCallback(() => {
    call<AgentSources>("/api/agent/sources").then(setSources).catch(() => undefined);
  }, []);
  useEffect(loadSources, [loadSources]);

  const mailOn = settings.includeMail && sources?.mail.connected === true;

  const startConnect = async () => {
    try {
      const data = await call<{ url: string }>("/api/agent/mail/auth-url");
      setConnect({ url: data.url, pasted: "", working: false, error: null });
    } catch (e) {
      setNotice(message(e, "메일 연결을 시작하지 못했습니다"));
    }
  };

  const finishConnect = async () => {
    if (!connect || !connect.pasted.trim()) return;
    setConnect({ ...connect, working: true, error: null });
    try {
      await call("/api/agent/mail/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: connect.pasted.trim() }) });
      setConnect(null);
      setSettings((s) => ({ ...s, includeMail: true }));
      loadSources();
    } catch (e) {
      setConnect((c) => (c ? { ...c, working: false, error: message(e, "메일을 연결하지 못했습니다") } : c));
    }
  };

  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const changeSheets = async (url: string, init: RequestInit) => {
    setSheetBusy(true);
    setSheetError(null);
    try {
      const data = await call<{ sheets: AgentSheet[] }>(url, init);
      setSources((prev) => (prev ? { ...prev, sheets: { ...prev.sheets, list: data.sheets } } : prev));
      setSheetUrl("");
    } catch (e) {
      setSheetError(message(e, "시트를 바꾸지 못했습니다"));
    } finally {
      setSheetBusy(false);
    }
  };
  const addSheet = () => {
    if (!sheetUrl.trim()) return;
    void changeSheets("/api/agent/sheets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: sheetUrl.trim() }) });
  };

  // Several approvals from one reply (e.g. tasks taken from a sheet) can be given together.
  const resolveAll = async (messageId: number, ids: string[]) => {
    for (const id of ids) await resolve(messageId, id, true);
  };

  const disconnectMail = async () => {
    try {
      await call("/api/agent/mail", { method: "DELETE" });
    } catch {
      // The switch below still turns reading off for this panel.
    }
    setSettings((s) => ({ ...s, includeMail: false }));
    loadSources();
  };

  // Pick up the conversation that was open last time.
  const loadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (conversationId === null || loadedFor.current === conversationId) return;
    loadedFor.current = conversationId;
    call<AgentConversationData>(`/api/agent/conversations/${conversationId}`)
      .then((data) => {
        setMessages(data.messages);
        setArtifacts(data.artifacts);
      })
      .catch(() => setSettings((s) => ({ ...s, conversationId: null }))); // deleted elsewhere: start fresh
  }, [conversationId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable: the choice still holds for this panel.
    }
  }, [settings]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, live, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadHistory = useCallback(() => {
    call<{ conversations: AgentConversationSummary[] }>("/api/agent/conversations")
      .then((data) => setHistory(data.conversations))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  const provider = providers?.find((p) => p.id === settings.provider);
  const model = settings.model || provider?.defaultModel || "";
  const modelListed = provider?.models.some((m) => m.id === model) ?? true;
  const canSend = draft.trim().length > 0 && !busy && provider?.available === true;

  const startNew = () => {
    loadedFor.current = null;
    setSettings((s) => ({ ...s, conversationId: null }));
    setMessages([]);
    setArtifacts([]);
    setNotice(null);
    setTab("chat");
  };

  const open = (id: number) => {
    setMessages([]);
    setArtifacts([]);
    setSettings((s) => ({ ...s, conversationId: id }));
    setTab("chat");
  };

  const remove = async (id: number) => {
    try {
      await call(`/api/agent/conversations/${id}`, { method: "DELETE" });
      if (id === conversationId) startNew();
      setTab("history");
      loadHistory();
    } catch (e) {
      setNotice(message(e, "대화를 지우지 못했습니다"));
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !provider?.available) return;
    const optimistic: AgentMessage = { id: -Date.now(), role: "user", text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setNotice(null);
    setLive({ status: "보내는 중…", say: "", steps: [] });
    try {
      const data = await sendChat(
        { provider: settings.provider, model, includePrivate: settings.includePrivate, includeMail: mailOn, text, ...(conversationId !== null ? { conversationId } : {}) },
        (event) => setLive((prev) => {
          const base = prev ?? { status: "", say: "", steps: [] };
          if (event.type === "status") return { ...base, status: event.text };
          if (event.type === "say") return { ...base, say: event.text };
          if (event.type === "step") return { ...base, steps: [...base.steps, event.step] };
          return base;
        })
      );
      loadedFor.current = data.conversationId;
      setSettings((s) => ({ ...s, conversationId: data.conversationId }));
      setMessages((prev) => [...prev, data.message]);
      setArtifacts(data.artifacts);
      // Candidates and other agents' messages change without anything in Cairn itself changing.
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
      if (data.changed) window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
      loadSources();
    } catch (e) {
      setMessages((prev) => [...prev, { id: -Date.now() - 1, role: "error", text: message(e, "답을 받지 못했습니다"), createdAt: new Date().toISOString() }]);
    } finally {
      setLive(null);
    }
  };

  const resolve = async (messageId: number, pendingId: string, approve: boolean) => {
    setWorking(pendingId);
    const finish = (step: AgentStep) => setMessages((prev) => prev.map((m) => (m.id === messageId && m.role === "agent"
      ? { ...m, pending: m.pending.map((p) => (p.id === pendingId ? { ...p, state: "done" as const } : p)), steps: [...m.steps, step] }
      : m)));
    try {
      const data = await call<{ step: AgentStep; changed: boolean; artifacts: AgentArtifact[] }>("/api/agent/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pendingId, approve })
      });
      finish(data.step);
      setArtifacts(data.artifacts);
      if (data.changed) announce();
    } catch (e) {
      finish({ tool: "confirm", ok: false, summary: message(e, "처리하지 못했습니다") });
    } finally {
      setWorking(null);
    }
  };

  const steps = (list: AgentStep[]) => list.length > 0 && (
    <ul className="agent-steps" role="list" aria-label="반영한 것">
      {list.map((step, i) => (
        <li key={i} className="agent-step" data-ok={step.ok ? "true" : "false"}>
          <span aria-hidden="true">{step.ok ? "✓" : "✕"}</span>
          <span className="agent-step-text">{step.summary}</span>
          {step.ok && step.link && <a className="note-meta-link" href={step.link}>보기</a>}
        </li>
      ))}
    </ul>
  );

  return createPortal(
    <>
      <div className="sheet-backdrop agent-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="agent-panel" role="dialog" aria-modal="true" aria-label="에이전트">
        <header className="agent-head">
          <h2 className="agent-title">에이전트</h2>
          <button type="button" className="note-text-btn" onClick={startNew} disabled={busy}>새 대화</button>
          <button type="button" className="note-flow-close" onClick={onClose} aria-label="닫기">✕</button>
        </header>

        <div className="agent-tabs" role="tablist" aria-label="에이전트 보기">
          <button type="button" role="tab" className="day-panel-tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>대화</button>
          <button type="button" role="tab" className="day-panel-tab" aria-selected={tab === "candidates"} onClick={() => setTab("candidates")}>
            후보{candidates.length > 0 && <span className="day-panel-tab-count">{candidates.length}</span>}
          </button>
          <button type="button" role="tab" className="day-panel-tab" aria-selected={tab === "items"} onClick={() => setTab("items")}>
            다룬 항목{artifacts.length > 0 && <span className="day-panel-tab-count">{artifacts.length}</span>}
          </button>
          <button type="button" role="tab" className="day-panel-tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>지난 대화</button>
        </div>

        {tab === "chat" && (
          <>
            <details className="agent-settings">
              <summary>
                {provider ? `${provider.label}${model ? ` · ${model}` : ""}` : "프로바이더 선택"}
                {settings.includePrivate && " · 비공개 메모 포함"}
                {mailOn && " · 메일 읽기"}
              </summary>
              <div className="notes-filter-row" role="group" aria-label="프로바이더">
                {(providers ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="notes-filter-chip"
                    aria-pressed={settings.provider === p.id}
                    disabled={!p.available || busy}
                    title={p.available ? p.via : `${p.via} — 이 서버에서 쓸 수 없음`}
                    onClick={() => { setCustomModel(false); setSettings((s) => ({ ...s, provider: p.id, model: p.defaultModel })); }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {provider && (
                <div className="agent-model">
                  <label className="note-field-label" htmlFor="agent-model">모델</label>
                  {customModel || !modelListed ? (
                    <input id="agent-model" className="note-input" value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} placeholder="모델 이름" disabled={busy} />
                  ) : (
                    <select
                      id="agent-model"
                      className="note-input"
                      value={model}
                      disabled={busy}
                      onChange={(e) => {
                        if (e.target.value === "__custom__") {
                          setCustomModel(true);
                          setSettings((s) => ({ ...s, model: "" }));
                        } else {
                          setSettings((s) => ({ ...s, model: e.target.value }));
                        }
                      }}
                    >
                      {provider.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      {provider.allowCustomModel && <option value="__custom__">직접 입력…</option>}
                    </select>
                  )}
                  <span className="note-hint">{provider.via}</span>
                </div>
              )}
              <label className="note-switch">
                <input type="checkbox" role="switch" checked={settings.includePrivate} disabled={busy} onChange={(e) => setSettings((s) => ({ ...s, includePrivate: e.target.checked }))} />
                <span>비공개 메모까지 읽기</span>
              </label>
              <p className="note-hint">
                {settings.includePrivate ? "모든 메모가 선택한 프로바이더로 전송될 수 있습니다." : "'AI 공개'를 켠 메모만 읽습니다. 일정·할 일·스레드는 항상 읽습니다."}
              </p>
              {sources && (sources.mail.configured || sources.reason.available) && (
                <div className="agent-source">
                  {sources.mail.connected && (
                    <>
                      <div className="agent-source-row">
                        <label className="note-switch">
                          <input type="checkbox" role="switch" checked={settings.includeMail} disabled={busy} onChange={(e) => setSettings((s) => ({ ...s, includeMail: e.target.checked }))} />
                          <span>메일 읽기</span>
                        </label>
                        <button type="button" className="note-text-btn" onClick={() => void disconnectMail()} disabled={busy}>연결 끊기</button>
                      </div>
                      <p className="note-hint">
                        {settings.includeMail ? "Gmail 을 검색하고 읽습니다 (읽기 전용). 읽은 메일은 선택한 프로바이더로 전송됩니다." : "꺼져 있으면 메일을 읽지 않습니다."}
                      </p>
                    </>
                  )}
                  {sources.mail.configured && !sources.mail.connected && !sources.sheets.connected && !connect && (
                    <div className="agent-source-row">
                      <span className="note-hint">Gmail·시트 연결 안 됨</span>
                      <button type="button" className="note-btn" onClick={() => void startConnect()}>Google 연결</button>
                    </div>
                  )}
                  {sources.sheets.connected && (
                    <div className="agent-sheets" role="group" aria-label="읽을 시트">
                      <span className="note-field-label">읽을 시트</span>
                      {sources.sheets.list.length > 0 && (
                        <ul className="agent-sheet-list" role="list">
                          {sources.sheets.list.map((sheet) => (
                            <li key={sheet.id} className="agent-source-row">
                              <a className="note-meta-link" href={sheet.url} target="_blank" rel="noreferrer">{sheet.name}</a>
                              <button type="button" className="note-text-btn" disabled={sheetBusy} onClick={() => void changeSheets(`/api/agent/sheets/${sheet.id}`, { method: "DELETE" })} aria-label={`${sheet.name} 시트 빼기`}>빼기</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="agent-source-row">
                        <input className="note-input" value={sheetUrl} onChange={(e) => { setSheetUrl(e.target.value); setSheetError(null); }} placeholder="스프레드시트 주소" aria-label="추가할 스프레드시트 주소" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                        <button type="button" className="note-btn" disabled={sheetBusy || !sheetUrl.trim()} onClick={addSheet}>{sheetBusy ? "확인 중…" : "추가"}</button>
                      </div>
                      {sheetError && <p className="sheet-error" role="alert">{sheetError}</p>}
                      <p className="note-hint">등록한 시트만 읽습니다 (읽기 전용). 읽은 내용은 선택한 프로바이더로 전송됩니다.</p>
                    </div>
                  )}
                  {(sources.mail.connected !== sources.sheets.connected) && !connect && (
                    <div className="agent-source-row">
                      <span className="note-hint">{sources.mail.connected ? "시트 읽기 권한 없음" : "메일 읽기 권한 없음"}</span>
                      <button type="button" className="note-btn" onClick={() => void startConnect()}>다시 연결</button>
                    </div>
                  )}
                  {sources.sheets.connected && !sources.mail.connected && (
                    <div className="agent-source-row">
                      <span />
                      <button type="button" className="note-text-btn" onClick={() => void disconnectMail()} disabled={busy}>연결 끊기</button>
                    </div>
                  )}
                  {connect && (
                    <div className="agent-connect">
                      <ol>
                        <li><a className="note-meta-link" href={connect.url} target="_blank" rel="noreferrer">구글 승인 화면 열기</a> (Gmail·스프레드시트 읽기 권한만 요청합니다)</li>
                        <li>승인하면 "연결할 수 없음" 화면이 나옵니다. 그 화면의 주소 전체를 복사하세요.</li>
                        <li>아래에 붙여 넣고 연결을 누르세요.</li>
                      </ol>
                      <input className="note-input" value={connect.pasted} onChange={(e) => setConnect({ ...connect, pasted: e.target.value, error: null })} placeholder="http://localhost:3456/?code=…" aria-label="승인 뒤 이동한 주소" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                      {connect.error && <p className="sheet-error" role="alert">{connect.error}</p>}
                      <div className="agent-source-row">
                        <button type="button" className="note-text-btn" onClick={() => setConnect(null)}>취소</button>
                        <button type="button" className="note-btn note-btn--primary" disabled={connect.working || !connect.pasted.trim()} onClick={() => void finishConnect()}>{connect.working ? "연결 중…" : "연결"}</button>
                      </div>
                    </div>
                  )}
                  {sources.reason.available && (
                    <p className="note-hint">
                      다른 에이전트: Reason Network 이름 "{sources.reason.session}"{sources.reason.unread > 0 ? ` · 안 읽은 메시지 ${sources.reason.unread}건` : ""}
                    </p>
                  )}
                </div>
              )}
            </details>
            {providers === null && <p className="note-hint agent-note" role="status">프로바이더 확인 중…</p>}
            {providers !== null && !provider?.available && <p className="sheet-error agent-note" role="alert">쓸 수 있는 프로바이더가 없습니다.</p>}

            <div className="agent-log" ref={logRef} role="log" aria-label="대화">
              {messages.map((m) => {
                if (m.role === "user") return <p key={m.id} className="agent-msg agent-msg--user">{m.text}</p>;
                if (m.role === "error") return <p key={m.id} className="agent-msg agent-msg--error" role="alert">{m.text}</p>;
                return (
                  <div key={m.id} className="agent-msg agent-msg--agent">
                    {m.text && <p className="agent-msg-text">{m.text}</p>}
                    {steps(m.steps)}
                    {m.pending.filter((p) => p.state === "waiting").length > 1 && (
                      <button type="button" className="note-btn note-btn--primary agent-approve-all" disabled={working !== null} onClick={() => void resolveAll(m.id, m.pending.filter((p) => p.state === "waiting").map((p) => p.id))}>
                        {m.pending.filter((p) => p.state === "waiting").length}건 모두 승인
                      </button>
                    )}
                    {m.pending.filter((p) => p.state === "waiting").map((p) => (
                      <div key={p.id} className="agent-pending" role="group" aria-label={`승인 필요: ${p.summary}`}>
                        <p className="agent-pending-text">{p.summary}</p>
                        {p.detail && <pre className="agent-pending-detail">{p.detail}</pre>}
                        <div className="agent-pending-actions">
                          <button type="button" className="note-btn" disabled={working === p.id} onClick={() => void resolve(m.id, p.id, false)}>하지 않음</button>
                          <button type="button" className="note-btn note-btn--primary" disabled={working === p.id} onClick={() => void resolve(m.id, p.id, true)}>
                            {working === p.id ? "처리 중…" : "승인"}
                          </button>
                        </div>
                      </div>
                    ))}
                    <p className="agent-msg-via">{m.via}</p>
                  </div>
                );
              })}
              {live && (
                <div className="agent-msg agent-msg--agent agent-msg--waiting" role="status" aria-label="답을 만드는 중">
                  {live.say && <p className="agent-msg-text">{live.say}</p>}
                  {steps(live.steps)}
                  <p className="agent-live-status">{live.status}</p>
                </div>
              )}
            </div>

            <form className="agent-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <textarea
                className="note-textarea"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="예: 실험 설계는 졸업 프로젝트의 일부로 연결"
                aria-label="에이전트에게 할 말"
                maxLength={4000}
                disabled={busy}
                autoFocus
              />
              <button type="submit" className="note-btn note-btn--primary" disabled={!canSend}>보내기</button>
            </form>
          </>
        )}

        {tab === "candidates" && (
          <div className="agent-items" role="tabpanel" aria-label="일정 후보">
            <CandidateList candidates={candidates} />
          </div>
        )}

        {tab === "items" && (
          <div className="agent-items" role="tabpanel" aria-label="다룬 항목">
            {TYPE_ORDER.filter((type) => artifacts.some((a) => a.targetType === type)).map((type) => (
              <section key={type} aria-label={TYPE_LABEL[type]}>
                <h3 className="agent-items-title">{TYPE_LABEL[type]}</h3>
                <ul className="agent-item-list" role="list">
                  {artifacts.filter((a) => a.targetType === type).map((a) => (
                    <li key={`${a.targetType}:${a.targetId}`} className="agent-item" data-type={a.targetType} data-gone={a.exists ? undefined : "true"}>
                      <div className="agent-item-main">
                        <p className="agent-item-label">{a.label}</p>
                        <p className="agent-item-meta">
                          {[a.exists ? shortWhen(a.when) : "지워짐", a.status, `이 대화에서: ${a.lastAction}`].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {a.exists && <a className="note-btn agent-item-open" href={a.link}>열기</a>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="agent-items" role="tabpanel" aria-label="지난 대화">
            {history === null && <p className="note-hint" role="status">불러오는 중…</p>}
            {notice && <p className="sheet-error" role="alert">{notice}</p>}
            {history !== null && history.length > 0 && (
              <ul className="agent-item-list" role="list">
                {history.map((c) => (
                  <li key={c.id} className="agent-item" data-current={c.id === conversationId ? "true" : undefined}>
                    <button type="button" className="agent-item-main agent-history-open" onClick={() => open(c.id)} aria-label={`${c.title} 열기`}>
                      <span className="agent-item-label">{c.title}</span>
                      <span className="agent-item-meta">{[shortWhen(c.updatedAt), c.model || c.provider].filter(Boolean).join(" · ")}</span>
                    </button>
                    <button type="button" className="note-text-btn" onClick={() => void remove(c.id)} aria-label={`${c.title} 대화 지우기`}>지우기</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body
  );
}
