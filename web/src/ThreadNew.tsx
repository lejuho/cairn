import { useState } from "react";
import type { CreateThreadDraftResponseData } from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";

type FormState = { name: string; kind: string; goal: string; deadline: string };
type SubmitState = { submitting: boolean; error: string | null };

type DraftState =
  | { tag: "idle" }
  | { tag: "submitting" }
  | { tag: "error"; message: string }
  | { tag: "success"; data: CreateThreadDraftResponseData };

export function ThreadNew() {
  const [form, setForm] = useState<FormState>({ name: "", kind: "", goal: "", deadline: "" });
  const [submitState, setSubmitState] = useState<SubmitState>({ submitting: false, error: null });
  const [draftText, setDraftText] = useState("");
  const [draft, setDraft] = useState<DraftState>({ tag: "idle" });

  async function handleDraftSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draftText.trim();
    if (!text || draft.tag === "submitting") return;
    setDraft({ tag: "submitting" });
    try {
      const body = await apiJson<{ ok: boolean; data?: CreateThreadDraftResponseData; error?: { message: string } }>("/api/threads/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!body.ok || !body.data) throw new Error(body.error?.message ?? "초안 생성 실패");
      setDraft({ tag: "success", data: body.data });
    } catch (err) {
      const e2 = err as Partial<AccessSessionError>;
      setDraft({ tag: "error", message: e2.kind === "access_session_required" ? (e2.message ?? "로그인 세션이 만료됐어") : (err instanceof Error ? err.message : "오류") });
    }
  }

  const nameInvalid = !form.name.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nameInvalid || submitState.submitting) return;

    setSubmitState({ submitting: true, error: null });
    try {
      const payload: Record<string, string> = { name: form.name.trim() };
      if (form.kind.trim()) payload.kind = form.kind.trim();
      if (form.goal.trim()) payload.goal = form.goal.trim();
      if (form.deadline) payload.deadline = form.deadline;

      const body = await apiJson<{ ok: boolean; data?: { id: number }; error?: { message: string } }>("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!body.ok) throw new Error(body.error?.message ?? "서버 오류");
      window.location.href = `/threads/${body.data!.id}`;
    } catch (e) {
      const err = e as Partial<AccessSessionError>;
      if (err.kind === "access_session_required") {
        setSubmitState({ submitting: false, error: err.message ?? "로그인 세션이 만료됐어" });
      } else {
        setSubmitState({ submitting: false, error: e instanceof Error ? e.message : "오류" });
      }
    }
  }

  return (
    <main className="app-shell" aria-labelledby="thread-new-title">
      <section className="quiet-card warm" style={{ width: "min(100%, 480px)" }}>
        <p className="eyebrow">새 스레드</p>
        <h1 id="thread-new-title" className="thread-name" style={{ fontSize: "1.4rem" }}>스레드 만들기</h1>
        <p style={{ marginBottom: "20px" }}>이름을 붙이고 일정·작업을 연결해봐.</p>

        <form onSubmit={(e) => void handleSubmit(e)} className="thread-new-form" noValidate>
          <label className="thread-new-label" htmlFor="tn-name">이름 *</label>
          <input
            id="tn-name"
            className="thread-new-input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="예: 일본 여행 준비"
            disabled={submitState.submitting}
            autoFocus
          />

          <label className="thread-new-label" htmlFor="tn-kind">종류</label>
          <input
            id="tn-kind"
            className="thread-new-input"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            placeholder="예: project, trip, errand"
            disabled={submitState.submitting}
          />

          <label className="thread-new-label" htmlFor="tn-goal">목표</label>
          <input
            id="tn-goal"
            className="thread-new-input"
            value={form.goal}
            onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
            placeholder="이 스레드가 완성됐을 때의 상태"
            disabled={submitState.submitting}
          />

          <label className="thread-new-label" htmlFor="tn-deadline">마감일</label>
          <input
            id="tn-deadline"
            type="date"
            className="thread-new-input"
            value={form.deadline}
            onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            disabled={submitState.submitting}
          />

          {submitState.error && (
            <p className="today-reply-error" role="alert">{submitState.error}</p>
          )}

          <button
            type="submit"
            className="today-submit-btn thread-new-submit"
            disabled={nameInvalid || submitState.submitting}
            aria-label="스레드 만들기 제출"
          >
            {submitState.submitting ? "..." : "만들기 →"}
          </button>
        </form>
      </section>

      <section className="quiet-card warm thread-draft-panel" style={{ width: "min(100%, 480px)", marginTop: "16px" }} aria-labelledby="thread-draft-title">
        <p className="eyebrow">자연어 초안</p>
        <h2 id="thread-draft-title" className="thread-name" style={{ fontSize: "1.1rem" }}>설명만 적으면 초안을 만들어줄게</h2>
        <p className="card-meta" style={{ marginBottom: "12px" }}>일정·작업·의존을 추론해 초안으로 저장해. 모르는 값은 비워두고 확인이 필요하다고 표시해.</p>

        <form onSubmit={(e) => void handleDraftSubmit(e)} className="thread-new-form" noValidate>
          <label className="thread-new-label" htmlFor="tn-draft">설명</label>
          <textarea
            id="tn-draft"
            className="thread-new-input thread-draft-textarea"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="예: 6월 초 파리 여행 준비. 항공권 예약하고 여권 유효기간 확인해야 해."
            rows={4}
            disabled={draft.tag === "submitting"}
            aria-label="자연어 초안 설명"
          />

          {draft.tag === "error" && (
            <p className="today-reply-error" role="alert">{draft.message}</p>
          )}

          <button
            type="submit"
            className="today-submit-btn thread-new-submit"
            disabled={!draftText.trim() || draft.tag === "submitting"}
            aria-label="초안 만들기 제출"
          >
            {draft.tag === "submitting" ? "초안 만드는 중…" : "초안 만들기 →"}
          </button>
        </form>

        {draft.tag === "success" && (
          <div className="thread-draft-success" data-testid="thread-draft-success" style={{ marginTop: "12px" }}>
            <p className="card-title">초안 “{draft.data.thread.name}” 만들어졌어</p>
            <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "6px 0" }}>
              <span className="card-chip">이벤트 {draft.data.events.length}</span>
              <span className="card-chip">작업 {draft.data.tasks.length}</span>
              <span className="card-chip">연결 {draft.data.nodeLinks.length}</span>
            </p>
            {draft.data.warnings.length > 0 && (
              <ul className="thread-draft-warnings" role="list" style={{ listStyle: "none", padding: 0, margin: "4px 0" }}>
                {draft.data.warnings.map((w, i) => (
                  <li key={i} className="card-meta" data-testid="draft-warning" style={{ color: "var(--moved)" }}>확인 필요: {w.message}</li>
                ))}
              </ul>
            )}
            <a className="thread-draft-link" data-testid="draft-open-link" href={`/threads/${draft.data.thread.id}`}>초안 열어서 수정·확인하기 →</a>
          </div>
        )}
      </section>
    </main>
  );
}
