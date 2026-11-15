import { useEffect, useState } from "react";
import type { PersonRow } from "@cairn/shared";
import { apiJson, DATA_CHANGED_EVENT } from "./api.js";

// Who an event is with. Linking people here is what fills in "최근 만남" and the meeting counts
// on each person's page, and lets scheduling take their preferences into account.

type ApiBody<T> = { ok: boolean; data?: T; error?: { message?: string } };

type Props = {
  eventId: number;
  // When the host already has the attendees, no request is made for them.
  initial?: Array<Pick<PersonRow, "id" | "name"> & Partial<PersonRow>> | undefined;
  // Told after each change. With `announce` off the rest of the app is not asked to reload
  // (for hosts that would lose an open form by reloading).
  onChanged?: ((people: PersonRow[]) => void) | undefined;
  announce?: boolean;
};

export function EventPeople({ eventId, initial, onChanged, announce = true }: Props) {
  const [people, setPeople] = useState<PersonRow[] | null>(initial ? (initial as PersonRow[]) : null);
  const [everyone, setEveryone] = useState<PersonRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setAdding(false);
    if (initial) {
      setPeople(initial as PersonRow[]);
      return;
    }
    setPeople(null);
    apiJson<ApiBody<{ people: PersonRow[] }>>(`/api/events/${eventId}/people`)
      .then((body) => alive && setPeople(body?.ok && Array.isArray(body.data?.people) ? body.data.people : []))
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
    // `initial` is read once per event; later changes come from this component itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  useEffect(() => {
    if (!adding || everyone !== null) return;
    let alive = true;
    apiJson<ApiBody<PersonRow[]>>("/api/people")
      .then((body) => alive && setEveryone(body?.ok && Array.isArray(body.data) ? body.data : []))
      .catch(() => alive && setEveryone([]));
    return () => {
      alive = false;
    };
  }, [adding, everyone]);

  if (people === null) return null;

  const save = async (next: PersonRow[]) => {
    setBusy(true);
    setError(null);
    try {
      const body = await apiJson<ApiBody<{ people: PersonRow[] }>>(`/api/events/${eventId}/people`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personIds: next.map((p) => p.id) })
      });
      if (!body?.ok) throw new Error(body?.error?.message ?? "참석자를 바꾸지 못했습니다");
      const saved = Array.isArray(body.data?.people) ? body.data.people : next;
      setPeople(saved);
      setQuery("");
      onChanged?.(saved);
      if (announce) window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (e) {
      setError(e instanceof Error ? e.message : "참석자를 바꾸지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const choices = (everyone ?? [])
    .filter((p) => !people.some((x) => x.id === p.id))
    .filter((p) => words.every((w) => `${p.name} ${p.relation ?? ""} ${(p.groups ?? []).join(" ")}`.toLowerCase().includes(w)))
    .slice(0, 6);

  return (
    <section className="event-people" aria-label="참석자">
      <h3 className="event-geo-title">참석자</h3>
      {people.length > 0 && (
        <ul className="event-people-list" role="list">
          {people.map((p) => (
            <li key={p.id} className="note-chip">
              <a className="note-chip-label" href={`/people/${p.id}`}>{p.name}</a>
              <button type="button" className="note-chip-remove" disabled={busy} onClick={() => void save(people.filter((x) => x.id !== p.id))} aria-label={`${p.name} 참석자에서 빼기`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="event-people-add">
          <input className="note-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·묶음으로 찾기" aria-label="참석자 찾기" autoFocus />
          {everyone === null && <p className="note-hint" role="status">불러오는 중…</p>}
          {everyone !== null && choices.length === 0 && <p className="note-hint">{everyone.length === 0 ? "사람 없음" : "검색 결과 없음"}</p>}
          {choices.length > 0 && (
            <ul className="note-picker-list" role="list">
              {choices.map((p) => (
                <li key={p.id}>
                  <button type="button" className="note-picker-option" disabled={busy} onClick={() => void save([...people, p])} aria-label={`${p.name} 참석자로 넣기`}>
                    <span className="note-picker-label">{p.name}</span>
                    {(p.groups ?? []).length > 0 && <span className="note-picker-when">{(p.groups ?? []).join(" · ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="note-text-btn" onClick={() => { setAdding(false); setQuery(""); }}>닫기</button>
        </div>
      ) : (
        <button type="button" className="note-btn" onClick={() => setAdding(true)}>+ 참석자</button>
      )}
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </section>
  );
}
