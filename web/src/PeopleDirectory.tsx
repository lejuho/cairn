import { useEffect, useState } from "react";
import type { PersonDirectoryRow } from "@cairn/shared";
import { apiJson, openAccessLogin } from "./api.js";
import type { AccessSessionError } from "./api.js";
import { formatLastMet } from "./lastMet.js";

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet" }
  | { tag: "live"; people: PersonDirectoryRow[] }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

function frequencyLabel(band: PersonDirectoryRow["frequencyBand"]): string {
  if (band === "frequent") return "자주 만남";
  if (band === "established") return "정기적";
  if (band === "rare") return "가끔 만남";
  return "처음 만남";
}

export function PeopleDirectory() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  async function load() {
    setView({ tag: "loading" });
    const now = new Date().toISOString();
    try {
      const body = await apiJson<{ ok: boolean; data?: { people: PersonDirectoryRow[] }; error?: { message: string } }>(
        `/api/people/directory?now=${encodeURIComponent(now)}`
      );
      if (!body.ok || !body.data) {
        setView({ tag: "error", message: body.error?.message ?? "불러오기 실패" });
        return;
      }
      const rows = body.data.people;
      setView(rows.length === 0 ? { tag: "quiet" } : { tag: "live", people: rows });
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setView({ tag: "access_error" });
      } else {
        setView({ tag: "error", message: e instanceof Error ? e.message : "불러오기 실패" });
      }
    }
  }

  useEffect(() => { void load(); }, []);

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="사람 목록" aria-busy="true">
        <div role="status" className="loading-indicator">불러오는 중…</div>
      </main>
    );
  }

  if (view.tag === "access_error") {
    return (
      <main className="app-shell" aria-label="사람 목록">
        <section className="quiet-card warm">
          <h1>로그인이 필요합니다</h1>
          <p>Cloudflare Access 세션이 만료됐거나 네트워크가 끊겼습니다.</p>
          <button className="action-btn" onClick={() => openAccessLogin()}>
            Access 로그인 다시 열기
          </button>
          <button className="action-btn" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-label="사람 목록">
        <section className="quiet-card warm">
          <p role="alert">{view.message}</p>
          <button className="action-btn" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  if (view.tag === "quiet") {
    return (
      <main className="app-shell" aria-label="사람 목록" data-testid="people-quiet">
        <section className="quiet-card empty-state">
          <h1>사람이 없습니다</h1>
          <a className="empty-add-btn" href="/input">+ 사람 추가</a>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" aria-label="사람 목록" data-testid="people-live">
      <h1 className="section-heading">사람</h1>
      <ul className="person-list" role="list">
        {view.people.map((p) => (
          <li key={p.id}>
            <a className="person-card" href={`/people/${p.id}`} aria-label={`${p.name} 상세`}>
              <div className="person-card-name">{p.name}</div>
              {p.relation && <div className="person-card-relation">{p.relation}</div>}
              <div className="person-card-stats">
                <span className="person-band">{frequencyLabel(p.frequencyBand)}</span>
                <span className="person-meets">{p.totalMeets}회</span>
                <span className="person-last-met">{formatLastMet(p.lastMet)}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
