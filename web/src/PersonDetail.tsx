import { useEffect, useState } from "react";
import type { EventRow, PersonDirectoryRow } from "@cairn/shared";
import { apiJson } from "./api.js";
import type { AccessSessionError } from "./api.js";

type ViewState =
  | { tag: "loading" }
  | { tag: "live"; person: PersonDirectoryRow; recentMeetings: EventRow[] }
  | { tag: "not_found" }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "시간 미정";
  const fmt = (iso: string) =>
    new Date(Date.parse(iso)).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return start ? fmt(start) : fmt(end!);
}

function frequencyLabel(band: PersonDirectoryRow["frequencyBand"]): string {
  if (band === "frequent") return "자주 만남";
  if (band === "established") return "정기적";
  if (band === "rare") return "가끔 만남";
  return "처음 만남";
}

function formatLastMet(lastMet: string | null): string {
  if (!lastMet) return "만남 기록 없음";
  const ms = Date.parse(lastMet);
  if (!Number.isFinite(ms)) return "만남 기록 없음";
  return new Date(ms).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export function PersonDetail({ id }: { id: number }) {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  async function load() {
    setView({ tag: "loading" });
    const now = new Date().toISOString();
    try {
      const body = await apiJson<{ ok: boolean; data?: { person: PersonDirectoryRow; recentMeetings: EventRow[] }; error?: { code?: string; message: string } }>(
        `/api/people/${id}/detail?now=${encodeURIComponent(now)}`
      );
      if (!body.ok) {
        if (body.error?.code === "NOT_FOUND") {
          setView({ tag: "not_found" });
        } else {
          setView({ tag: "error", message: body.error?.message ?? "불러오기 실패" });
        }
        return;
      }
      setView({ tag: "live", person: body.data!.person, recentMeetings: body.data!.recentMeetings });
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setView({ tag: "access_error" });
      } else {
        setView({ tag: "error", message: e instanceof Error ? e.message : "불러오기 실패" });
      }
    }
  }

  useEffect(() => { void load(); }, [id]);

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="사람 상세" aria-busy="true">
        <div role="status" className="loading-indicator">불러오는 중…</div>
      </main>
    );
  }

  if (view.tag === "access_error") {
    return (
      <main className="app-shell" aria-label="사람 상세">
        <section className="quiet-card warm">
          <h1>로그인 세션이 필요해</h1>
          <p>Cloudflare Access 세션이 만료됐거나 네트워크가 끊겼어.</p>
          <button className="action-btn" onClick={() => window.location.assign(window.location.href)}>
            Access 로그인 다시 열기
          </button>
          <button className="action-btn" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  if (view.tag === "not_found") {
    return (
      <main className="app-shell" aria-label="사람 상세" data-testid="person-not-found">
        <section className="quiet-card warm">
          <h1>사람을 찾을 수 없어</h1>
          <p>이미 삭제됐거나 잘못된 링크일 수 있어.</p>
          <a className="action-btn" href="/people">사람 목록으로</a>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-label="사람 상세">
        <section className="quiet-card warm">
          <p role="alert">{view.message}</p>
          <button className="action-btn" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  const { person, recentMeetings } = view;
  const hasHistory = recentMeetings.length > 0;

  return (
    <main className="app-shell" aria-label="사람 상세" data-testid="person-live">
      <a className="back-link" href="/people">← 사람 목록</a>
      <header className="person-detail-header">
        <h1 className="person-detail-name">{person.name}</h1>
        {person.relation && <p className="person-detail-relation">{person.relation}</p>}
        {person.channel && person.channel !== "none" && (
          <p className="person-detail-channel" aria-label="연락 채널">{person.channel}</p>
        )}
      </header>

      <section className="person-detail-memory" aria-label="관계 기억">
        <h2>관계 기억</h2>
        <dl className="person-stats">
          <div>
            <dt>총 만남</dt>
            <dd>{person.totalMeets}회</dd>
          </div>
          <div>
            <dt>마지막 만남</dt>
            <dd>{formatLastMet(person.lastMet)}</dd>
          </div>
          <div>
            <dt>빈도</dt>
            <dd>{frequencyLabel(person.frequencyBand)}</dd>
          </div>
        </dl>
      </section>

      {person.hardConstraints && person.hardConstraints.length > 0 && (
        <section className="person-detail-constraints" aria-label="요일 제약">
          <h2>만나기 어려운 요일</h2>
          <ul className="constraint-list">
            {person.hardConstraints.map((c, i) => (
              <li key={i}>{c.text}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="person-detail-meetings" aria-label="최근 만남">
        <h2>최근 만남</h2>
        {hasHistory ? (
          <ul className="meeting-list">
            {recentMeetings.map((ev) => (
              <li key={ev.id} className="meeting-item">
                <span className="meeting-title">{ev.title}</span>
                <span className="meeting-window">{formatWindow(ev.start, ev.end)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="person-quiet">아직 기록된 만남이 없어.</p>
        )}
      </section>
    </main>
  );
}
