import { useState } from "react";
import { apiJson, type AccessSessionError } from "./api.js";

type FormState = { name: string; kind: string; goal: string; deadline: string };
type SubmitState = { submitting: boolean; error: string | null };

export function ThreadNew() {
  const [form, setForm] = useState<FormState>({ name: "", kind: "", goal: "", deadline: "" });
  const [submitState, setSubmitState] = useState<SubmitState>({ submitting: false, error: null });

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
    </main>
  );
}
