import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NoteEventDraftData, NoteKind, NoteListData, NoteRelatedTarget, NoteTargetType, NoteTargetView, NoteView } from "@cairn/shared";
import { apiJson, openAccessLogin } from "./api.js";

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

// Other parts of the app listen for this to refresh after a note is saved elsewhere
// (the quick-note sheet lives in the nav, lists live in pages).
export const NOTES_CHANGED_EVENT = "cairn:notes-changed";

function announceChange(): void {
  window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiJson<ApiResponse<T>>(url, init);
  if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || "요청을 처리하지 못했습니다");
  return res.data;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return fallback;
}

const TIME_ZONE = "Asia/Seoul";

export function todayLocal(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function localDateOf(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : todayLocal(new Date(ms));
}

// Written out by hand: the browser's own long date format differs between engines ("목" vs "(목)").
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${weekday})`;
}

function formatWhen(value: string | null): string {
  const date = localDateOf(value);
  if (!date) return "";
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const TARGET_LABEL: Record<NoteTargetType, string> = { event: "일정", task: "할 일", thread: "스레드" };

function targetHref(t: { targetType: NoteTargetType; targetId: number }): string {
  return t.targetType === "thread" ? `/threads/${t.targetId}` : `/notes?targetType=${t.targetType}&targetId=${t.targetId}`;
}

function sameTarget(a: { targetType: string; targetId: number }, b: { targetType: string; targetId: number }): boolean {
  return a.targetType === b.targetType && a.targetId === b.targetId;
}

// ── Target picker ───────────────────────────────────────────────────────────

function TargetPicker({ selected, onAdd, only }: { selected: NoteTargetView[]; onAdd: (t: NoteTargetView) => void; only?: NoteTargetType }) {
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<NoteTargetView[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    const timer = window.setTimeout(() => {
      const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      call<{ targets: NoteTargetView[] }>(`/api/notes/targets${qs}`)
        .then((data) => {
          if (!live) return;
          setTargets(Array.isArray(data?.targets) ? data.targets : []);
          setState("ready");
        })
        .catch(() => live && setState("error"));
    }, query ? 250 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const choices = targets.filter((t) => (!only || t.targetType === only) && !selected.some((s) => sameTarget(s, t)));

  return (
    <div className="note-picker">
      <input
        className="note-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={only === "thread" ? "스레드 이름으로 찾기" : "일정·할 일·스레드 이름으로 찾기"}
        aria-label={only === "thread" ? "스레드 찾기" : "붙일 대상 찾기"}
      />
      {state === "loading" && <p className="note-hint">찾는 중…</p>}
      {state === "error" && <p className="note-hint" role="alert">대상을 불러오지 못했습니다. 다시 입력하세요.</p>}
      {state === "ready" && choices.length === 0 && (
        query.trim() ? <p className="note-hint">검색 결과 없음</p> : null
      )}
      {choices.length > 0 && (
        <ul className="note-picker-list" role="list">
          {choices.map((t) => (
            <li key={`${t.targetType}:${t.targetId}`}>
              <button type="button" className="note-picker-option" onClick={() => onAdd(t)}>
                <span className="note-chip-kind">{TARGET_LABEL[t.targetType]}</span>
                <span className="note-picker-label">{t.label}</span>
                {t.when && <span className="note-picker-when">{formatWhen(t.when)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Line editor ─────────────────────────────────────────────────────────────
// One row per line: a bullet (note) or a checkbox (checklist) on the left, the text
// wrapping beside it. Enter starts a new row; Backspace at the start of a row joins it
// to the one above.

type Line = { key: number; text: string; done: boolean; id?: number };

const MAX_LINES = 100;
let lineKeySeq = 0;

function newLine(text = "", done = false, id?: number): Line {
  return { key: ++lineKeySeq, text, done, ...(id !== undefined ? { id } : {}) };
}

function stripMarker(text: string): string {
  return text.replace(/^\s*(?:[-*•]\s+|\[[ xX]?\]\s*)/, "");
}

function bodyLines(body: string | null): string[] {
  return (body ?? "").split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
}

function linesFromNote(note: NoteView | undefined): Line[] {
  if (!note) return [newLine()];
  if (note.kind === "checklist" && note.items.length > 0) return note.items.map((item) => newLine(item.text, item.done, item.id));
  const lines = bodyLines(note.body);
  return lines.length > 0 ? lines.map((text) => newLine(text)) : [newLine()];
}

type LineEditorProps = {
  kind: NoteKind;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

function LineEditor({ kind, lines, onChange, onSubmit, disabled, autoFocus }: LineEditorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const inputs = useRef(new Map<number, HTMLTextAreaElement>());
  const pendingFocus = useRef<{ key: number; caret: number } | null>(null);
  const latest = useRef({ lines, onChange });
  latest.current = { lines, onChange };

  useLayoutEffect(() => {
    for (const el of inputs.current.values()) {
      el.style.height = "auto";
      if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
    }
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    const el = inputs.current.get(focus.key);
    if (el) {
      el.focus();
      el.setSelectionRange(focus.caret, focus.caret);
    }
  });

  const edit = (index: number, value: string) => {
    const current = lines[index];
    if (!current) return;
    if (!value.includes("\n")) {
      onChange(lines.map((line, i) => (i === index ? { ...line, text: value } : line)));
      return;
    }
    const parts = value.split("\n");
    const room = MAX_LINES - lines.length;
    if (room <= 0) {
      onChange(lines.map((line, i) => (i === index ? { ...line, text: parts.join(" ") } : line)));
      return;
    }
    const added = parts.slice(1, 1 + room).map((part) => newLine(stripMarker(part)));
    const last = added[added.length - 1]!;
    // Enter puts the caret at the start of the new row; a multi-line paste leaves it at the end.
    pendingFocus.current = { key: last.key, caret: added.length === 1 ? 0 : last.text.length };
    onChange([...lines.slice(0, index), { ...current, text: parts[0] ?? "" }, ...added, ...lines.slice(index + 1)]);
  };

  // Joins row `index` onto the row above. Reads through a ref so the native listener below stays current.
  const mergeUp = useRef((index: number): boolean => {
    const { lines: now, onChange: change } = latest.current;
    const prev = now[index - 1];
    const current = now[index];
    if (!prev || !current) return false;
    pendingFocus.current = { key: prev.key, caret: prev.text.length };
    change([...now.slice(0, index - 1), { ...prev, text: prev.text + current.text }, ...now.slice(index + 1)]);
    return true;
  });

  // Phone keyboards often report Backspace as an unidentified key, so keydown alone misses it.
  // `beforeinput` names the edit itself and fires on every keyboard.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onBeforeInput = (event: Event) => {
      const el = event.target;
      if ((event as InputEvent).inputType !== "deleteContentBackward" || !(el instanceof HTMLTextAreaElement)) return;
      if (el.selectionStart !== 0 || el.selectionEnd !== 0) return;
      if (mergeUp.current(Number(el.dataset.lineIndex))) event.preventDefault();
    };
    list.addEventListener("beforeinput", onBeforeInput);
    return () => list.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  return (
    <ul
      ref={listRef}
      className="line-editor"
      data-kind={kind}
      role="list"
      aria-label={kind === "checklist" ? "체크리스트 항목" : "메모 내용"}
      onClick={(e) => {
        // Tapping the empty space under the rows continues on the last one.
        if (e.target !== e.currentTarget) return;
        const last = lines[lines.length - 1];
        if (last) inputs.current.get(last.key)?.focus();
      }}
    >
      {lines.map((line, index) => (
        <li key={line.key} className="line-editor-row" data-done={kind === "checklist" && line.done ? "true" : undefined}>
          {kind === "checklist" ? (
            <input
              type="checkbox"
              className="line-editor-check"
              checked={line.done}
              disabled={disabled}
              onChange={(e) => onChange(lines.map((l, i) => (i === index ? { ...l, done: e.target.checked } : l)))}
              aria-label={`${index + 1}번째 항목 완료`}
            />
          ) : (
            <span className="line-editor-bullet" aria-hidden="true">•</span>
          )}
          <textarea
            ref={(el) => {
              if (el) inputs.current.set(line.key, el);
              else inputs.current.delete(line.key);
            }}
            className="line-editor-input"
            data-line-index={index}
            rows={1}
            value={line.text}
            onChange={(e) => edit(index, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSubmit?.();
                return;
              }
              const el = e.currentTarget;
              if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && mergeUp.current(index)) {
                e.preventDefault();
              }
            }}
            placeholder={index === 0 ? (kind === "checklist" ? "할 일 입력 후 엔터" : "내용 입력. 엔터로 다음 줄") : ""}
            aria-label={`${index + 1}번째 줄`}
            maxLength={kind === "checklist" ? 300 : 2000}
            disabled={disabled}
            autoFocus={autoFocus && index === 0}
          />
        </li>
      ))}
    </ul>
  );
}

// Read-only rendering of the same shape, used on cards and in the attach step.
function NoteLines({ kind, lines }: { kind: NoteKind; lines: Array<{ text: string; done: boolean }> }) {
  return (
    <ul className="note-lines" data-kind={kind} role="list">
      {lines.map((line, index) => (
        <li key={index} className="note-line" data-done={kind === "checklist" && line.done ? "true" : undefined}>
          <span className="note-line-mark" aria-hidden="true">{kind === "checklist" ? (line.done ? "☑" : "☐") : "•"}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Draft (what is being written, shared by the inline and full-screen composers) ──

type Draft = { kind: NoteKind; title: string; lines: Line[] };

function filledLines(draft: Draft): Line[] {
  return draft.lines.filter((line) => line.text.trim());
}

function canSaveDraft(draft: Draft): boolean {
  return filledLines(draft).length > 0 || (draft.kind === "note" && draft.title.trim().length > 0);
}

function draftContent(draft: Draft): { body: string | null; items: Array<{ id?: number; text: string; done: boolean }> } {
  const filled = filledLines(draft);
  if (draft.kind === "checklist") {
    return {
      body: null,
      items: filled.map((line) => ({ ...(line.id !== undefined ? { id: line.id } : {}), text: line.text.trim().slice(0, 300), done: line.done }))
    };
  }
  return { body: filled.map((line) => line.text.trimEnd()).join("\n").slice(0, 10_000) || null, items: [] };
}

// remoteVisible: may remote AI connectors (ChatGPT etc.) read this note. Off unless the user turns it on.
type Placement = { date: string; targets: NoteTargetView[]; remoteVisible: boolean };

async function saveDraft(draft: Draft, placement: Placement, note: NoteView | undefined): Promise<NoteView> {
  const { body, items } = draftContent(draft);
  const title = draft.title.trim();
  const links = placement.targets.map((t) => ({ targetType: t.targetType, targetId: t.targetId }));
  if (note) {
    // Item ids only mean something while the note stays a checklist.
    const kept = note.kind === "checklist" ? items : items.map(({ text, done }) => ({ text, done }));
    const data = await call<{ note: NoteView }>(`/api/notes/${note.id}`, jsonInit("PATCH", {
      kind: draft.kind, title: title || null, body, items: kept, noteDate: placement.date || null, links,
      remoteVisible: placement.remoteVisible
    }));
    return data.note;
  }
  const data = await call<{ note: NoteView }>("/api/notes", jsonInit("POST", {
    kind: draft.kind,
    ...(title ? { title } : {}),
    ...(draft.kind === "note" ? (body ? { body } : {}) : { items }),
    ...(placement.date ? { noteDate: placement.date } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(placement.remoteVisible ? { remoteVisible: true } : {}),
    addedBy: "web"
  }));
  return data.note;
}

function KindToggle({ kind, onChange, disabled }: { kind: NoteKind; onChange: (kind: NoteKind) => void; disabled?: boolean }) {
  return (
    <div className="note-kind-toggle" role="group" aria-label="메모 종류">
      <button type="button" aria-pressed={kind === "note"} disabled={disabled} onClick={() => onChange("note")}>메모</button>
      <button type="button" aria-pressed={kind === "checklist"} disabled={disabled} onClick={() => onChange("checklist")}>체크리스트</button>
    </div>
  );
}

// ── Inline composer: written where it belongs, so there is nothing to place ──

function InlineNoteComposer({ placement, onSaved }: { placement: Placement; onSaved: (note: NoteView) => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({ kind: "note", title: "", lines: [newLine()] }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = canSaveDraft(draft) && !saving;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveDraft(draft, placement, undefined);
      announceChange();
      onSaved(saved);
    } catch (e) {
      setSaving(false);
      setError(errorText(e, "메모를 저장하지 못했습니다"));
    }
  };

  return (
    <form className="note-composer note-composer--compact" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="메모 쓰기">
      <KindToggle kind={draft.kind} onChange={(kind) => setDraft((d) => ({ ...d, kind }))} disabled={saving} />
      <LineEditor
        kind={draft.kind}
        lines={draft.lines}
        onChange={(lines) => setDraft((d) => ({ ...d, lines }))}
        onSubmit={() => void save()}
        disabled={saving}
        autoFocus
      />
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <div className="note-composer-actions">
        <button type="submit" className="note-btn note-btn--primary" disabled={!ready}>{saving ? "저장 중…" : "메모 저장"}</button>
      </div>
    </form>
  );
}

// ── Full-screen note flow: step 1 write, step 2 choose where it goes ─────────

type NoteFlowProps = {
  note?: NoteView | undefined;
  defaultDate?: string | null | undefined;
  defaultTargets?: NoteTargetView[] | undefined;
  onClose: () => void;
  onSaved?: (note: NoteView) => void;
};

export function NoteFlow({ note, defaultDate, defaultTargets, onClose, onSaved }: NoteFlowProps) {
  const [step, setStep] = useState<"write" | "place">("write");
  const [draft, setDraft] = useState<Draft>(() => ({ kind: note?.kind ?? "note", title: note?.title ?? "", lines: linesFromNote(note) }));
  const [showTitle, setShowTitle] = useState(Boolean(note?.title));
  const [date, setDate] = useState<string>(note ? note.noteDate ?? "" : defaultDate ?? "");
  const [targets, setTargets] = useState<NoteTargetView[]>(note ? note.links.filter((l) => l.exists) : defaultTargets ?? []);
  const [remoteVisible, setRemoteVisible] = useState(note?.remoteVisible ?? false);
  // What the writing becomes. Chosen in step 2, after the writing is done; editing a saved note keeps it a note.
  const [what, setWhat] = useState<"note" | "task" | "event">("note");
  const [thread, setThread] = useState<NoteTargetView | null>(() => (defaultTargets ?? []).find((t) => t.targetType === "thread") ?? null);
  const [estMinutes, setEstMinutes] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState({ title: "", start: "09:00", end: "10:00", touched: false });
  const [aiState, setAiState] = useState<"idle" | "reading" | "read" | "unread">("idle");
  // Editing a saved note: it can also be turned into an event, or its items into tasks, from here.
  const [toEvent, setToEvent] = useState(false);
  const [convertBusy, setConvertBusy] = useState<number | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const makeTask = async (itemId: number) => {
    if (!note) return;
    setConvertBusy(itemId);
    setConvertError(null);
    try {
      const data = await call<{ note: NoteView }>(`/api/notes/${note.id}/items/${itemId}/task`, { method: "POST" });
      announceChange();
      onSaved?.(data.note);
    } catch (e) {
      setConvertError(errorText(e, "할 일로 만들지 못했습니다"));
    } finally {
      setConvertBusy(null);
    }
  };
  const aiText = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filled = filledLines(draft);
  const firstLine = draft.title.trim() || filled[0]?.text.trim() || "";
  const writtenText = [draft.title.trim(), ...filled.map((l) => l.text.trim())].filter(Boolean).join("\n");
  const eventTitle = eventForm.touched ? eventForm.title : eventForm.title || firstLine;
  const eventValid = eventTitle.trim().length > 0 && eventForm.start !== "" && eventForm.end > eventForm.start;
  const ready = canSaveDraft(draft) && !saving && (what !== "event" || step === "write" || eventValid);
  const today = todayLocal();
  const tomorrow = shiftDate(today, 1);

  // "일정" chosen: read the date and time out of the writing in the background. The fields stay
  // editable meanwhile, and anything the user already changed is left alone.
  useEffect(() => {
    if (what !== "event" || step !== "place" || !writtenText || aiText.current === writtenText) return;
    aiText.current = writtenText;
    setAiState("reading");
    let live = true;
    call<NoteEventDraftData>("/api/notes/event-draft", jsonInit("POST", { text: writtenText.slice(0, 2000) }))
      .then((d) => {
        if (!live) return;
        const start = d?.parseStatus === "parsed" ? d.start : null;
        if (!start) {
          setAiState("unread");
          return;
        }
        setAiState("read");
        setEventForm((f) => (f.touched ? f : { title: d.title, start: clockOf(start), end: d.end ? clockOf(d.end) : f.end, touched: false }));
        setDate((prev) => (dateTouched.current ? prev : localDateOf(start) ?? prev));
      })
      .catch(() => live && setAiState("unread"));
    return () => {
      live = false;
    };
  }, [what, step, writtenText]);
  const dateTouched = useRef(false);
  const pickDate = (value: string) => {
    dateTouched.current = true;
    setDate(value);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    const kind = note || step === "write" ? "note" : what;
    const threadTargets = thread ? [thread] : [];
    try {
      if (kind === "note") {
        const saved = await saveDraft(draft, { date, targets, remoteVisible }, note);
        onSaved?.(saved);
      } else if (kind === "task") {
        if (draft.kind === "checklist") {
          // The checklist stays as a note; each item becomes a task that follows its checkbox.
          const saved = await saveDraft(draft, { date, targets: threadTargets, remoteVisible: false }, undefined);
          for (const item of saved.items) {
            await call(`/api/notes/${saved.id}/items/${item.id}/task`, jsonInit("POST", estMinutes ? { estMinutes } : {}));
          }
        } else {
          const rest = filled.slice(draft.title.trim() ? 0 : 1).map((l) => l.text.trim()).join("\n");
          await call("/api/tasks", jsonInit("POST", {
            title: firstLine.slice(0, 200),
            ...(rest ? { context: rest } : {}),
            ...(date ? { due: date } : {}),
            ...(estMinutes ? { estMinutes } : {}),
            ...(thread ? { threadId: thread.targetId } : {})
          }));
        }
      } else {
        const day = date || today;
        const times = { title: eventTitle.trim().slice(0, 200), start: localStamp(day, eventForm.start), end: localStamp(day, eventForm.end) };
        if (filled.length > 1 || (draft.title.trim() && filled.length > 0)) {
          // More was written than a title: keep it as a note attached to the new event.
          const saved = await saveDraft(draft, { date: day, targets: threadTargets, remoteVisible: false }, undefined);
          await call(`/api/notes/${saved.id}/event`, jsonInit("POST", times));
        } else {
          await call("/api/events", jsonInit("POST", { ...times, ...(thread ? { threadId: thread.targetId } : {}) }));
        }
      }
      announceChange();
      onClose();
    } catch (e) {
      setSaving(false);
      setError(errorText(e, kind === "note" ? "메모를 저장하지 못했습니다" : kind === "task" ? "할 일을 만들지 못했습니다" : "일정을 만들지 못했습니다"));
    }
  };

  const heading = note ? "메모 고치기" : "빠른 기록";
  const taskCount = draft.kind === "checklist" ? filled.length : 1;
  const whatHint = what === "note"
    ? "쓴 글이 그대로 남습니다."
    : what === "task"
      ? draft.kind === "checklist" ? `항목 ${filled.length}개가 각각 할 일이 됩니다. 체크리스트도 함께 남습니다.` : "첫 줄이 할 일 제목, 나머지는 설명이 됩니다."
      : filled.length > 1 ? "일정을 만들고, 쓴 글은 그 일정의 메모로 붙습니다." : "쓴 글로 일정을 만듭니다.";
  const saveLabel = what === "note" || note
    ? null
    : what === "task" ? (taskCount > 1 ? `할 일 만들기 (${taskCount}개)` : "할 일 만들기") : "일정 만들기";
  const placeSummary = [
    date ? formatWhen(date) : "날짜 없음",
    targets.length > 0 ? `${targets.length}곳에 붙임` : null,
    remoteVisible ? "AI 공개" : null
  ].filter(Boolean).join(" · ");

  // Rendered at the document root: a note can be edited from inside a sheet or panel, and a
  // fixed-position screen nested in a transformed ancestor would be clipped to it.
  return createPortal(
    <>
      <div className="sheet-backdrop note-flow-backdrop" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={heading} className="note-flow" data-step={step}>
        <header className="note-flow-bar">
          <button type="button" className="note-flow-close" onClick={onClose} aria-label="닫기">✕</button>
          <h2 className="note-flow-title">{heading}</h2>
          <span className="note-flow-step" aria-label={step === "write" ? "1단계: 쓰기" : "2단계: 붙일 곳"}>{step === "write" ? "1/2 쓰기" : "2/2 붙일 곳"}</span>
        </header>

        <div className="note-flow-body">
          <section className="note-flow-write" aria-label={step === "write" ? "쓰기" : "쓴 내용"}>
            {step === "write" ? (
              <>
                <div className="note-flow-tools">
                  <KindToggle kind={draft.kind} onChange={(kind) => setDraft((d) => ({ ...d, kind }))} disabled={saving} />
                  {!showTitle && <button type="button" className="note-text-btn" onClick={() => setShowTitle(true)}>+ 제목</button>}
                </div>
                {showTitle && (
                  <input
                    className="note-flow-title-input"
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="제목"
                    aria-label="메모 제목"
                    maxLength={200}
                    disabled={saving}
                  />
                )}
                <LineEditor
                  kind={draft.kind}
                  lines={draft.lines}
                  onChange={(lines) => setDraft((d) => ({ ...d, lines }))}
                  onSubmit={() => ready && setStep("place")}
                  disabled={saving}
                  autoFocus
                />
              </>
            ) : (
              <button type="button" className="note-flow-preview" onClick={() => setStep("write")} aria-label="쓴 내용 고치러 돌아가기">
                {draft.title.trim() && <span className="note-flow-preview-title">{draft.title.trim()}</span>}
                <NoteLines kind={draft.kind} lines={filledLines(draft)} />
              </button>
            )}
          </section>

          {step === "place" && (
            <section className="note-flow-place" aria-label="붙일 곳 고르기">
              {!note && (
                <div className="note-flow-field">
                  <span className="note-field-label">무엇으로 남길까요?</span>
                  <div className="notes-filter-row" role="group" aria-label="무엇으로 남길까요?">
                    <button type="button" className="notes-filter-chip" aria-pressed={what === "note"} onClick={() => setWhat("note")}>메모</button>
                    <button type="button" className="notes-filter-chip" aria-pressed={what === "task"} onClick={() => setWhat("task")}>할 일</button>
                    <button type="button" className="notes-filter-chip" aria-pressed={what === "event"} onClick={() => setWhat("event")}>일정</button>
                  </div>
                  <p className="note-hint">{whatHint}</p>
                </div>
              )}
              {what === "event" && (
                <div className="note-flow-field">
                  <span className="note-field-label">일정 제목</span>
                  <input
                    className="note-input"
                    value={eventTitle}
                    onChange={(e) => setEventForm((f) => ({ ...f, title: e.target.value, touched: true }))}
                    maxLength={200}
                    aria-label="일정 제목"
                    disabled={saving}
                  />
                </div>
              )}
              <div className="note-flow-field">
                <span className="note-field-label">{what === "task" ? "마감" : "날짜"}</span>
                <div className="notes-filter-row" role="group" aria-label="날짜 고르기">
                  <button type="button" className="notes-filter-chip" aria-pressed={date === today} onClick={() => pickDate(today)}>오늘</button>
                  <button type="button" className="notes-filter-chip" aria-pressed={date === tomorrow} onClick={() => pickDate(tomorrow)}>내일</button>
                  {what !== "event" && <button type="button" className="notes-filter-chip" aria-pressed={date === ""} onClick={() => pickDate("")}>없음</button>}
                </div>
                <input
                  className="note-input"
                  type="date"
                  value={what === "event" ? date || today : date}
                  onChange={(e) => pickDate(e.target.value)}
                  aria-label={what === "note" ? "메모 날짜" : what === "task" ? "마감 날짜" : "일정 날짜"}
                  disabled={saving}
                />
              </div>
              {what === "event" && (
                <div className="note-flow-field">
                  <div className="note-attach">
                    <label className="note-date-field">
                      <span className="note-field-label">시작</span>
                      <input className="note-input" type="time" value={eventForm.start} onChange={(e) => setEventForm((f) => ({ ...f, title: eventTitle, start: e.target.value, touched: true }))} aria-label="시작 시간" disabled={saving} />
                    </label>
                    <label className="note-date-field">
                      <span className="note-field-label">끝</span>
                      <input className="note-input" type="time" value={eventForm.end} onChange={(e) => setEventForm((f) => ({ ...f, title: eventTitle, end: e.target.value, touched: true }))} aria-label="끝 시간" disabled={saving} />
                    </label>
                  </div>
                  <p className="note-hint" role="status">
                    {aiState === "reading" && "쓴 글에서 날짜와 시간을 읽는 중… 기다리지 않고 직접 선택해도 됩니다."}
                    {aiState === "read" && "쓴 글에서 읽은 값입니다. 맞는지 확인하고 고치세요."}
                    {aiState === "unread" && "날짜를 읽지 못했습니다. 직접 선택하세요."}
                  </p>
                  {eventForm.end <= eventForm.start && <p className="sheet-error" role="alert">끝 시간이 시작보다 늦어야 합니다.</p>}
                </div>
              )}
              {what === "task" && (
                <div className="note-flow-field">
                  <span className="note-field-label">예상 시간</span>
                  <div className="notes-filter-row" role="group" aria-label="예상 시간">
                    {([[null, "모름"], [15, "15분"], [30, "30분"], [60, "1시간"], [120, "2시간"]] as const).map(([value, label]) => (
                      <button key={label} type="button" className="notes-filter-chip" aria-pressed={estMinutes === value} onClick={() => setEstMinutes(value)}>{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {what === "note" ? (
                <div className="note-flow-field">
                  <span className="note-field-label">일정·할 일·스레드</span>
                  {targets.length > 0 && (
                    <ul className="note-chip-list" role="list" aria-label="붙인 곳">
                      {targets.map((t) => (
                        <li key={`${t.targetType}:${t.targetId}`} className="note-chip">
                          <span className="note-chip-kind">{TARGET_LABEL[t.targetType]}</span>
                          <span className="note-chip-label">{t.label}</span>
                          <button
                            type="button"
                            className="note-chip-remove"
                            onClick={() => setTargets((prev) => prev.filter((p) => !sameTarget(p, t)))}
                            aria-label={`${t.label} 떼기`}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <TargetPicker selected={targets} onAdd={(t) => setTargets((prev) => [...prev, t])} />
                </div>
              ) : (
                <div className="note-flow-field">
                  <span className="note-field-label">스레드 (선택)</span>
                  {thread ? (
                    <ul className="note-chip-list" role="list" aria-label="넣을 스레드">
                      <li className="note-chip">
                        <span className="note-chip-kind">스레드</span>
                        <span className="note-chip-label">{thread.label}</span>
                        <button type="button" className="note-chip-remove" onClick={() => setThread(null)} aria-label={`${thread.label} 빼기`}>✕</button>
                      </li>
                    </ul>
                  ) : (
                    <TargetPicker only="thread" selected={[]} onAdd={setThread} />
                  )}
                </div>
              )}
              {note && (
                <div className="note-flow-field" role="group" aria-label="이 메모로 만들기">
                  <span className="note-field-label">이 메모로 만들기 (선택)</span>
                  <p className="note-hint">메모는 그대로 남고, 만든 일정·할 일에 붙습니다. 저장된 내용 기준입니다.</p>
                  <button type="button" className="note-btn note-convert-btn" onClick={() => setToEvent(true)}>일정으로 만들기</button>
                  {note.items.length > 0 && (
                    <ul className="note-convert-list" role="list" aria-label="항목을 할 일로">
                      {note.items.map((item) => (
                        <li key={item.id} className="note-item-row">
                          <span className="note-convert-text">{item.text}</span>
                          {item.taskId != null ? (
                            <span className="note-badge note-badge--muted">할 일</span>
                          ) : (
                            <button type="button" className="note-text-btn" disabled={convertBusy === item.id} onClick={() => void makeTask(item.id)} aria-label={`${item.text} 할 일로 만들기`}>
                              할 일로
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {convertError && <p className="sheet-error" role="alert">{convertError}</p>}
                </div>
              )}
              {what === "note" && (
                <div className="note-flow-field">
                  <span className="note-field-label">AI 커넥터</span>
                  <label className="note-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={remoteVisible}
                      onChange={(e) => setRemoteVisible(e.target.checked)}
                      disabled={saving}
                      aria-describedby="note-remote-hint"
                    />
                    <span>ChatGPT 같은 원격 AI에 공개</span>
                  </label>
                  <p className="note-hint" id="note-remote-hint">
                    {remoteVisible ? "원격 AI가 이 메모를 읽을 수 있습니다." : "꺼져 있으면 이 기기와 Pi 안에서만 보입니다."}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        {error && <p className="sheet-error note-flow-error" role="alert">{error}</p>}
        <footer className="note-flow-actions">
          {step === "write" ? (
            <>
              <button type="button" className="note-btn" disabled={!ready} onClick={() => void save()}>
                {saving ? "저장 중…" : note ? "바로 저장" : "오늘로 바로 저장"}
              </button>
              <button type="button" className="note-btn note-btn--primary" disabled={!ready} onClick={() => setStep("place")}>
                다음: 붙일 곳 →
              </button>
            </>
          ) : (
            <>
              <button type="button" className="note-btn" disabled={saving} onClick={() => setStep("write")}>← 내용 고치기</button>
              <button type="button" className="note-btn note-btn--primary" disabled={!ready} onClick={() => void save()}>
                {saving ? "저장 중…" : saveLabel ?? `저장 (${placeSummary})`}
              </button>
            </>
          )}
        </footer>
      </div>
      {toEvent && note && <NoteToEvent note={note} onClose={() => setToEvent(false)} onCreated={(next) => onSaved?.(next)} />}
    </>,
    document.body
  );
}

// ── Note → event (AI reads the date, the user confirms) ─────────────────────

const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function clockOf(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "09:00" : clockFormat.format(new Date(ms));
}

// Local date + time → RFC3339 in the app's zone (Korea has no daylight saving time).
function localStamp(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

type EventForm = { title: string; date: string; start: string; end: string };

function NoteToEvent({ note, onClose, onCreated }: { note: NoteView; onClose: () => void; onCreated: (note: NoteView) => void }) {
  const [form, setForm] = useState<EventForm | null>(null);
  const [parsed, setParsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = note.id;
  const fallbackDate = note.noteDate ?? todayLocal();
  const fallbackTitle = note.title ?? bodyLines(note.body)[0] ?? note.items[0]?.text ?? "메모";

  useEffect(() => {
    let live = true;
    const manual: EventForm = { title: fallbackTitle, date: fallbackDate, start: "09:00", end: "10:00" };
    call<NoteEventDraftData>(`/api/notes/${noteId}/event-draft`, { method: "POST" })
      .then((draft) => {
        if (!live) return;
        if (draft?.parseStatus === "parsed" && draft.start) {
          setParsed(true);
          setForm({ title: draft.title, date: localDateOf(draft.start) ?? fallbackDate, start: clockOf(draft.start), end: draft.end ? clockOf(draft.end) : "10:00" });
        } else {
          setForm({ ...manual, title: draft?.title || manual.title });
        }
      })
      .catch(() => live && setForm(manual));
    return () => {
      live = false;
    };
  }, [noteId, fallbackDate, fallbackTitle]);

  const valid = form !== null && form.title.trim().length > 0 && form.date !== "" && form.start !== "" && form.end !== "" && form.end > form.start;

  const create = async () => {
    if (!form || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = await call<{ note: NoteView }>(`/api/notes/${noteId}/event`, jsonInit("POST", {
        title: form.title.trim(), start: localStamp(form.date, form.start), end: localStamp(form.date, form.end)
      }));
      announceChange();
      onCreated(data.note);
      onClose();
    } catch (e) {
      setSaving(false);
      setError(errorText(e, "일정을 만들지 못했습니다"));
    }
  };

  const set = (patch: Partial<EventForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return createPortal(
    <>
      <div className="sheet-backdrop note-flow-backdrop" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="메모를 일정으로" className="sheet sheet--entering note-to-event">
        <span className="sheet-handle" aria-hidden="true" />
        <h2 className="sheet-title">메모를 일정으로</h2>
        {form === null ? (
          <p className="note-hint" role="status">메모에서 날짜와 시간을 읽는 중…</p>
        ) : (
          <form className="note-composer" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <p className="note-hint" role="status">
              {parsed ? "메모에서 읽은 값입니다. 맞는지 확인하고 고치세요." : "날짜를 읽지 못했습니다. 직접 선택하세요."}
            </p>
            <label className="note-date-field">
              <span className="note-field-label">제목</span>
              <input className="note-input" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} aria-label="일정 제목" disabled={saving} />
            </label>
            <div className="note-attach">
              <label className="note-date-field">
                <span className="note-field-label">날짜</span>
                <input className="note-input" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} aria-label="일정 날짜" disabled={saving} />
              </label>
              <label className="note-date-field">
                <span className="note-field-label">시작</span>
                <input className="note-input" type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} aria-label="시작 시간" disabled={saving} />
              </label>
              <label className="note-date-field">
                <span className="note-field-label">끝</span>
                <input className="note-input" type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} aria-label="끝 시간" disabled={saving} />
              </label>
            </div>
            {form.end <= form.start && <p className="sheet-error" role="alert">끝 시간이 시작보다 늦어야 합니다.</p>}
            <p className="note-hint">메모는 그대로 남고, 만든 일정에 붙습니다.</p>
            {error && <p className="sheet-error" role="alert">{error}</p>}
            <div className="note-composer-actions">
              <button type="button" className="note-btn" onClick={onClose} disabled={saving}>그만두기</button>
              <button type="submit" className="note-btn note-btn--primary" disabled={!valid || saving}>{saving ? "만드는 중…" : "일정 만들기"}</button>
            </div>
          </form>
        )}
      </div>
    </>,
    document.body
  );
}

// ── Note card ───────────────────────────────────────────────────────────────

type CardProps = {
  note: NoteView;
  // The target this list is already scoped to; its chip is redundant there.
  hideTarget?: { targetType: NoteTargetType; targetId: number } | undefined;
  onChanged: (note: NoteView) => void;
  onRemoved: (id: number) => void;
};

export function NoteCard({ note, hideTarget, onChanged, onRemoved }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<number | null>(null);

  const patch = async (body: unknown, failure: string) => {
    try {
      const data = await call<{ note: NoteView }>(`/api/notes/${note.id}`, jsonInit("PATCH", body));
      setError(null);
      announceChange();
      onChanged(data.note);
    } catch (e) {
      setError(errorText(e, failure));
    }
  };

  const toggleItem = async (itemId: number, done: boolean) => {
    setBusyItem(itemId);
    try {
      const data = await call<{ note: NoteView }>(`/api/notes/${note.id}/items/${itemId}`, jsonInit("PATCH", { done }));
      setError(null);
      onChanged(data.note);
    } catch (e) {
      setError(errorText(e, "체크를 저장하지 못했습니다"));
    } finally {
      setBusyItem(null);
    }
  };

  const remove = async () => {
    try {
      await call(`/api/notes/${note.id}`, { method: "DELETE" });
      announceChange();
      onRemoved(note.id);
    } catch (e) {
      setError(errorText(e, "메모를 지우지 못했습니다"));
    }
  };

  const links = note.links.filter((l) => !(hideTarget && sameTarget(l, hideTarget)));
  const doneCount = note.items.filter((i) => i.done).length;

  return (
    <li className="note-card" data-pinned={note.pinned ? "true" : undefined} data-archived={note.archivedAt ? "true" : undefined} data-testid={`note-${note.id}`}>
      {(note.title || note.pinned || note.archivedAt || note.remoteVisible) && (
        <div className="note-card-head">
          {note.title && <h3 className="note-card-title">{note.title}</h3>}
          {note.pinned && <span className="note-badge">고정</span>}
          {note.remoteVisible && <span className="note-badge note-badge--shared">AI 공개</span>}
          {note.archivedAt && <span className="note-badge note-badge--muted">보관됨</span>}
        </div>
      )}
      {note.body && <NoteLines kind="note" lines={bodyLines(note.body).map((text) => ({ text, done: false }))} />}
      {note.items.length > 0 && (
        <ul className="note-items" role="list" aria-label={`체크리스트 (${doneCount}/${note.items.length} 완료)`}>
          {note.items.map((item) => (
            <li key={item.id} className="note-item-row">
              <label className="note-item" data-done={item.done ? "true" : undefined}>
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busyItem === item.id}
                  onChange={(e) => void toggleItem(item.id, e.target.checked)}
                />
                <span>{item.text}</span>
              </label>
              {item.taskId != null && <span className="note-badge note-badge--muted">할 일</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="note-card-meta">
        {note.items.length > 0 && <span className="note-progress">{doneCount}/{note.items.length}</span>}
        {note.noteDate && <a className="note-meta-link" href={`/notes?date=${note.noteDate}`}>{formatWhen(note.noteDate)}</a>}
        {links.map((l) => (
          l.exists ? (
            <a key={`${l.targetType}:${l.targetId}`} className="note-chip note-chip--link" href={targetHref(l)}>
              <span className="note-chip-kind">{TARGET_LABEL[l.targetType]}</span>
              <span className="note-chip-label">{l.label}</span>
              {l.when && <span className="note-picker-when">{formatWhen(l.when)}</span>}
            </a>
          ) : (
            <span key={`${l.targetType}:${l.targetId}`} className="note-chip note-chip--gone">{TARGET_LABEL[l.targetType]} 지워짐</span>
          )
        ))}
      </div>
      <div className="note-card-actions">
        <button type="button" className="note-text-btn" onClick={() => setEditing(true)}>고치기</button>
        <button type="button" className="note-text-btn" onClick={() => void patch({ pinned: !note.pinned }, "고정을 바꾸지 못했습니다")}>
          {note.pinned ? "고정 풀기" : "고정"}
        </button>
        <button
          type="button"
          className="note-text-btn"
          aria-pressed={note.remoteVisible}
          onClick={() => void patch({ remoteVisible: !note.remoteVisible }, "공개 설정을 바꾸지 못했습니다")}
        >
          {note.remoteVisible ? "AI 비공개로" : "AI 공개"}
        </button>
        <button type="button" className="note-text-btn" onClick={() => void patch({ archived: !note.archivedAt }, "보관 상태를 바꾸지 못했습니다")}>
          {note.archivedAt ? "다시 꺼내기" : "보관"}
        </button>
        {confirmDelete ? (
          <>
            <button type="button" className="note-text-btn note-text-btn--danger" onClick={() => void remove()}>정말 지우기</button>
            <button type="button" className="note-text-btn" onClick={() => setConfirmDelete(false)}>그만두기</button>
          </>
        ) : (
          <button type="button" className="note-text-btn" onClick={() => setConfirmDelete(true)}>지우기</button>
        )}
      </div>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      {editing && <NoteFlow note={note} onClose={() => setEditing(false)} onSaved={onChanged} />}
    </li>
  );
}

function replaceNote(list: NoteView[], next: NoteView): NoteView[] {
  return list.map((n) => (n.id === next.id ? next : n));
}

// ── Notes attached to one place (event, task, thread, or a day) ─────────────

type AttachedProps = {
  title?: string;
  target?: NoteTargetView;
  date?: string;
  // When given, no request is made until something changes (the parent already loaded them).
  initial?: NoteView[];
  // False when the host screen has its own way to start a note here.
  canAdd?: boolean;
};

export function AttachedNotes({ title = "메모", target, date, initial, canAdd = true }: AttachedProps) {
  const [notes, setNotes] = useState<NoteView[]>(initial ?? []);
  const [state, setState] = useState<"loading" | "ready" | "error">(initial ? "ready" : "loading");
  const [adding, setAdding] = useState(false);
  const targetType = target?.targetType;
  const targetId = target?.targetId;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (targetType && targetId) {
      params.set("targetType", targetType);
      params.set("targetId", String(targetId));
    } else if (date) {
      params.set("date", date);
    }
    return params.toString();
  }, [targetType, targetId, date]);

  const load = useCallback(async () => {
    try {
      const data = await call<NoteListData>(`/api/notes?${query}`);
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [query]);

  const skipFirstLoad = useRef(initial !== undefined);
  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
    } else {
      void load();
    }
    const onChange = () => void load();
    window.addEventListener(NOTES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NOTES_CHANGED_EVENT, onChange);
  }, [load]);

  return (
    <section className="attached-notes" aria-label={title} data-testid="attached-notes">
      <div className="attached-notes-head">
        <p className="event-detail-section-label">{title}{notes.length > 0 ? ` ${notes.length}` : ""}</p>
{canAdd && (
          <button type="button" className="note-text-btn" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
          {adding ? "닫기" : "+ 메모"}
        </button>
        )}
      </div>
      {adding && (
        <InlineNoteComposer
          placement={{ date: target ? "" : date ?? "", targets: target ? [target] : [], remoteVisible: false }}
          onSaved={() => setAdding(false)}
        />
      )}
      {state === "loading" && <p className="note-hint">메모 불러오는 중…</p>}
      {state === "error" && (
        <p className="note-hint" role="alert">
          메모를 불러오지 못했습니다. <button type="button" className="note-text-btn" onClick={() => void load()}>다시 시도</button>
        </p>
      )}
      {notes.length > 0 && (
        <ul className="note-list" role="list">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              hideTarget={target}
              onChanged={(next) => setNotes((prev) => replaceNote(prev, next))}
              onRemoved={(id) => setNotes((prev) => prev.filter((n) => n.id !== id))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Quick note sheet (opened from the nav on any screen) ────────────────────

export function QuickNoteSheet({ onClose }: { onClose: () => void }) {
  return <NoteFlow defaultDate={todayLocal()} onClose={onClose} />;
}

// ── /notes page ─────────────────────────────────────────────────────────────

type KindFilter = "all" | "note" | "checklist" | "open";

type Filters = {
  q: string;
  from: string;
  to: string;
  kind: KindFilter;
  archived: boolean;
  targetType: NoteTargetType | null;
  targetId: number | null;
};

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const date = params.get("date") ?? "";
  const type = params.get("targetType");
  const id = Number(params.get("targetId"));
  const hasTarget = (type === "event" || type === "task" || type === "thread") && Number.isInteger(id) && id > 0;
  return {
    q: params.get("q") ?? "",
    from: date || (params.get("from") ?? ""),
    to: date || (params.get("to") ?? ""),
    kind: "all",
    archived: false,
    targetType: hasTarget ? (type as NoteTargetType) : null,
    targetId: hasTarget ? id : null
  };
}

function toQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set("q", f.q.trim());
  if (f.from && f.from === f.to) params.set("date", f.from);
  else {
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
  }
  if (f.kind === "note" || f.kind === "checklist") params.set("kind", f.kind);
  if (f.kind === "open") params.set("open", "true");
  if (f.archived) params.set("includeArchived", "true");
  if (f.targetType && f.targetId) {
    params.set("targetType", f.targetType);
    params.set("targetId", String(f.targetId));
  }
  return params.toString();
}

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "note", label: "메모" },
  { id: "checklist", label: "체크리스트" },
  { id: "open", label: "안 끝난 것" }
];

function groupByDay(notes: NoteView[]): Array<{ key: string; label: string; notes: NoteView[] }> {
  const groups: Array<{ key: string; label: string; notes: NoteView[] }> = [];
  const pinned = notes.filter((n) => n.pinned);
  if (pinned.length > 0) groups.push({ key: "pinned", label: "고정", notes: pinned });
  for (const note of notes) {
    if (note.pinned) continue;
    const day = note.noteDate ?? localDateOf(note.createdAt) ?? "";
    const last = groups[groups.length - 1];
    if (last && last.key === day) last.notes.push(note);
    else groups.push({ key: day, label: day ? formatDay(day) : "날짜 없음", notes: [note] });
  }
  return groups;
}

function RelatedTargets({ related, onPick }: { related: NoteRelatedTarget[]; onPick: (t: NoteRelatedTarget) => void }) {
  if (related.length === 0) return null;
  return (
    <section className="notes-related" aria-label="이름이 걸린 일정·할 일·스레드">
      <p className="event-detail-section-label">이름이 걸린 일정·할 일·스레드</p>
      <ul className="notes-related-list" role="list">
        {related.map((t) => (
          <li key={`${t.targetType}:${t.targetId}`} className="notes-related-row">
            <button type="button" className="notes-related-btn" onClick={() => onPick(t)}>
              <span className="note-chip-kind">{TARGET_LABEL[t.targetType]}</span>
              <span className="notes-related-label">{t.label}</span>
              <span className="notes-related-meta">
                {[localDateOf(t.when), t.location, t.noteCount > 0 ? `메모 ${t.noteCount}` : "메모 없음"].filter(Boolean).join(" · ")}
              </span>
            </button>
            {t.targetType === "thread" && <a className="note-meta-link" href={`/threads/${t.targetId}`}>열기</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NotesPage() {
  const [filters, setFilters] = useState<Filters>(() => readFilters(window.location.search));
  const [draftQuery, setDraftQuery] = useState(filters.q);
  const [data, setData] = useState<NoteListData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [targetLabel, setTargetLabel] = useState<string | null>(null);
  const [customRange, setCustomRange] = useState(false);
  const [writing, setWriting] = useState(false);
  const query = toQuery(filters);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await call<NoteListData>(`/api/notes${query ? `?${query}` : ""}`);
      if (mine !== seq.current) return;
      setData({ notes: next?.notes ?? [], total: next?.total ?? 0, related: next?.related ?? [] });
      setState("ready");
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorText(e, "메모를 불러오지 못했습니다"));
      setNeedsLogin(Boolean(e && typeof e === "object" && "kind" in e && e.kind === "access_session_required"));
      setState("error");
    }
  }, [query]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(NOTES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NOTES_CHANGED_EVENT, onChange);
  }, [load]);

  // Typing searches after a short pause; no submit needed.
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((f) => (f.q === draftQuery ? f : { ...f, q: draftQuery })), 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    window.history.replaceState(null, "", `/notes${query ? `?${query}` : ""}`);
  }, [query]);

  const { targetType, targetId } = filters;
  useEffect(() => {
    if (!targetType || !targetId) {
      setTargetLabel(null);
      return;
    }
    const linked = data?.notes.flatMap((n) => n.links).find((l) => l.targetType === targetType && l.targetId === targetId);
    if (linked) setTargetLabel(linked.label);
  }, [data, targetType, targetId]);

  const today = todayLocal();
  const setRange = (from: string, to: string) => setFilters((f) => ({ ...f, from, to }));
  const filtered = Boolean(filters.q.trim() || filters.from || filters.to || filters.kind !== "all" || filters.targetType || filters.archived);
  const clear = () => {
    setDraftQuery("");
    setFilters({ q: "", from: "", to: "", kind: "all", archived: false, targetType: null, targetId: null });
  };
  const scopedTarget: NoteTargetView | undefined = targetType && targetId
    ? { targetType, targetId, label: targetLabel ?? `${TARGET_LABEL[targetType]} #${targetId}`, when: null, status: null, exists: true }
    : undefined;
  const groups = data ? groupByDay(data.notes) : [];
  const presetRange = (!filters.from && !filters.to)
    || (filters.to === today && [today, shiftDate(today, -6), shiftDate(today, -29)].includes(filters.from));
  // A range that no preset chip explains (e.g. opened from a date link) keeps the inputs visible.
  const showRange = customRange || !presetRange;

  return (
    <main className="notes-page" aria-labelledby="notes-title">
      <header className="notes-header">
        <div>
          <h1 id="notes-title">메모</h1>
          <p>적어두고, 날짜·일정·할 일·스레드에 붙여 두세요. 나중에 여기서 다시 찾을 수 있습니다.</p>
        </div>
        <button type="button" className="note-btn note-btn--primary" onClick={() => setWriting(true)}>+ 새 메모</button>
      </header>
      {writing && (
        <NoteFlow
          defaultDate={filters.from && filters.from === filters.to ? filters.from : today}
          defaultTargets={scopedTarget ? [scopedTarget] : []}
          onClose={() => setWriting(false)}
        />
      )}

      <section className="notes-panel notes-search" aria-label="메모 찾기">
        <input
          className="note-input notes-search-input"
          type="search"
          value={draftQuery}
          onChange={(e) => setDraftQuery(e.target.value)}
          placeholder="메모 내용, 일정·할 일·스레드 이름으로 찾기"
          aria-label="메모 검색"
        />
        <div className="notes-filter-row" role="group" aria-label="종류">
          {KIND_FILTERS.map((k) => (
            <button key={k.id} type="button" className="notes-filter-chip" aria-pressed={filters.kind === k.id} onClick={() => setFilters((f) => ({ ...f, kind: k.id }))}>
              {k.label}
            </button>
          ))}
          <button type="button" className="notes-filter-chip" aria-pressed={filters.archived} onClick={() => setFilters((f) => ({ ...f, archived: !f.archived }))}>
            보관함 포함
          </button>
        </div>
        <div className="notes-filter-row" role="group" aria-label="기간">
          <button type="button" className="notes-filter-chip" aria-pressed={filters.from === today && filters.to === today} onClick={() => setRange(today, today)}>오늘</button>
          <button type="button" className="notes-filter-chip" aria-pressed={filters.from === shiftDate(today, -6) && filters.to === today} onClick={() => setRange(shiftDate(today, -6), today)}>최근 7일</button>
          <button type="button" className="notes-filter-chip" aria-pressed={filters.from === shiftDate(today, -29) && filters.to === today} onClick={() => setRange(shiftDate(today, -29), today)}>최근 30일</button>
          <button type="button" className="notes-filter-chip" aria-pressed={!filters.from && !filters.to} onClick={() => setRange("", "")}>전체 기간</button>
          <button type="button" className="notes-filter-chip" aria-pressed={showRange} onClick={() => setCustomRange((open) => !open)}>날짜 지정</button>
        </div>
        {showRange && (
          <div className="notes-range">
            <label>
              <span className="note-field-label">부터</span>
              <input className="note-input" type="date" value={filters.from} onChange={(e) => setRange(e.target.value, filters.to)} aria-label="시작 날짜" />
            </label>
            <label>
              <span className="note-field-label">까지</span>
              <input className="note-input" type="date" value={filters.to} onChange={(e) => setRange(filters.from, e.target.value)} aria-label="끝 날짜" />
            </label>
          </div>
        )}
        {scopedTarget && (
          <p className="notes-scope">
            <span className="note-chip">
              <span className="note-chip-kind">{TARGET_LABEL[scopedTarget.targetType]}</span>
              <span className="note-chip-label">{scopedTarget.label}</span>
            </span>
            에 붙은 메모만 보는 중
            <button type="button" className="note-text-btn" onClick={() => setFilters((f) => ({ ...f, targetType: null, targetId: null }))}>풀기</button>
          </p>
        )}
        {filtered && <button type="button" className="note-text-btn" onClick={clear}>조건 모두 지우기</button>}
      </section>

      {state === "loading" && (
        <div aria-label="메모 불러오는 중" aria-busy="true">
          <div className="today-skel" />
        </div>
      )}
      {state === "error" && (
        <section className="notes-panel" role="alert">
          <h2 className="notes-empty-title">메모를 불러오지 못했습니다</h2>
          <p>{error}</p>
          {needsLogin && <button type="button" className="note-btn note-btn--primary" onClick={openAccessLogin}>다시 로그인</button>}
          <button type="button" className="note-btn" onClick={() => { setState("loading"); void load(); }}>다시 시도</button>
        </section>
      )}
      {state === "ready" && data && (
        <>
          {filters.q.trim() && (
            <RelatedTargets
              related={data.related}
              onPick={(t) => {
                setTargetLabel(t.label);
                setDraftQuery("");
                setFilters((f) => ({ ...f, q: "", from: "", to: "", targetType: t.targetType, targetId: t.targetId }));
              }}
            />
          )}
          {data.notes.length === 0 ? (
            // No notes at all: the "+ 새 메모" button above is enough. A search that found nothing still says so.
            filtered ? (
              <section className="notes-panel notes-empty" data-testid="notes-empty">
                <h2 className="notes-empty-title">검색 결과 없음</h2>
              </section>
            ) : null
          ) : (
            <div className="notes-results" data-testid="notes-live">
              <p className="note-hint">
                {data.total > data.notes.length ? `${data.total}개 중 ${data.notes.length}개` : `${data.total}개`}
              </p>
              {groups.map((group) => (
                <section key={group.key} className="notes-group" aria-label={group.label}>
                  <h2 className="notes-group-title">{group.label}</h2>
                  <ul className="note-list" role="list">
                    {group.notes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onChanged={(next) => setData((prev) => (prev ? { ...prev, notes: replaceNote(prev.notes, next) } : prev))}
                        onRemoved={() => void load()}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
