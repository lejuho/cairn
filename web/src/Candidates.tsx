import { useCallback, useEffect, useRef, useState } from "react";
import type { EventCandidate } from "@cairn/shared";
import { apiJson, DATA_CHANGED_EVENT } from "./api.js";

// Events found outside Cairn — in mail, by another agent — wait here until the user decides.
// Nothing reaches the calendar without "일정에 넣기".

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

const ORIGIN_LABEL: Record<string, string> = { gmail: "메일", reason: "다른 에이전트", conversation: "대화", x: "X", luma: "Luma" };
const VERDICT_LABEL: Record<string, string> = { possible: "참석 가능", tight: "빠듯함", hard: "어려움", unknown: "확인 필요" };

export function useCandidates(): { candidates: EventCandidate[]; reload: () => void } {
  const [candidates, setCandidates] = useState<EventCandidate[]>([]);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    apiJson<ApiResponse<{ candidates: EventCandidate[] }>>("/api/inbox/candidates")
      .then((res) => {
        if (mine === seq.current && res?.ok === true && Array.isArray(res.data?.candidates)) setCandidates(res.data.candidates);
      })
      .catch(() => undefined); // The rest of the screen works without this list.
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener(DATA_CHANGED_EVENT, reload);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, reload);
  }, [reload]);
  return { candidates, reload };
}

export function candidateWhen(start: string, end: string | null): string {
  const s = new Date(start);
  if (Number.isNaN(s.getTime())) return start;
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][s.getDay()];
  const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const e = end ? new Date(end) : null;
  const sameDay = e && !Number.isNaN(e.getTime()) && e.toDateString() === s.toDateString();
  return `${s.getMonth() + 1}월 ${s.getDate()}일 (${weekday}) ${time(s)}${sameDay ? `–${time(e)}` : ""}`;
}

function sourceOf(c: EventCandidate): string {
  const origin = c.origin ? ORIGIN_LABEL[c.origin] ?? c.origin : null;
  const raw = c.note?.split("\n").find((line) => line.startsWith("출처: "))?.slice(4).trim();
  // "메일 · 메일: 제목" 처럼 같은 말이 두 번 나오지 않게 한다.
  const cited = raw && origin && raw.startsWith(`${origin}:`) ? raw.slice(origin.length + 1).trim() : raw;
  const by = c.proposedBy && c.proposedBy !== "cairn-agent" ? c.proposedBy : null;
  return [origin, cited ?? by].filter(Boolean).join(" · ");
}

export function CandidateList({ candidates, label = "일정 후보" }: { candidates: EventCandidate[]; label?: string }) {
  const [working, setWorking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (id: number, decision: "accept" | "reject") => {
    setWorking(id);
    setError(null);
    try {
      const res = await apiJson<ApiResponse<unknown>>(`/api/inbox/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, answeredBy: "web" })
      });
      if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || "처리하지 못했습니다");
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다");
    } finally {
      setWorking(null);
    }
  };

  if (candidates.length === 0) return null;
  return (
    <section className="candidates" aria-label={label}>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <ul className="candidate-list" role="list">
        {candidates.map((c) => {
          const extra = c.note?.split("\n").filter((line) => !line.startsWith("출처: ")).join(" ").trim();
          const source = sourceOf(c);
          return (
            <li key={c.id} className="candidate" data-verdict={c.verdict ?? undefined}>
              <p className="candidate-title">{c.title}</p>
              <p className="candidate-meta">
                {[candidateWhen(c.start, c.end), c.online ? "온라인" : c.location].filter(Boolean).join(" · ")}
                {c.verdict && VERDICT_LABEL[c.verdict] && <span className="candidate-verdict">{VERDICT_LABEL[c.verdict]}</span>}
              </p>
              {source && <p className="candidate-source">출처: {source}</p>}
              {extra && <p className="candidate-note">{extra}</p>}
              {c.verdict !== "possible" && c.reasons.length > 0 && <p className="candidate-note">{c.reasons.join(" ")}</p>}
              <div className="candidate-actions">
                {c.url && <a className="note-meta-link" href={c.url} target="_blank" rel="noreferrer">원문</a>}
                <button type="button" className="note-btn" disabled={working === c.id} onClick={() => void answer(c.id, "reject")} aria-label={`${c.title} 버리기`}>버리기</button>
                <button type="button" className="note-btn note-btn--primary" disabled={working === c.id} onClick={() => void answer(c.id, "accept")} aria-label={`${c.title} 일정에 넣기`}>
                  {working === c.id ? "처리 중…" : "일정에 넣기"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
