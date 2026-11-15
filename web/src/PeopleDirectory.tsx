import { useEffect, useMemo, useState } from "react";
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

// Which people the list opens on.
//   near   — someone you have an event with in the next 30 days, or had one in the last 30
//   pinned — the ones you chose to keep at hand
//   all    — everyone
type Scope = "near" | "pinned" | "all";

function eventWhen(start: string): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getMonth() + 1}/${d.getDate()} (${weekday})${time === "00:00" ? "" : ` ${time}`}`;
}

function localDay(start: string): string {
  const d = new Date(start);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Soonest upcoming first; then the most recently met.
export function byNearness(a: PersonDirectoryRow, b: PersonDirectoryRow): number {
  if (a.upcoming && b.upcoming) return Date.parse(a.upcoming.start) - Date.parse(b.upcoming.start);
  if (a.upcoming) return -1;
  if (b.upcoming) return 1;
  return Date.parse(b.recent?.start ?? "") - Date.parse(a.recent?.start ?? "");
}

function frequencyLabel(band: PersonDirectoryRow["frequencyBand"]): string {
  if (band === "frequent") return "자주 만남";
  if (band === "established") return "정기적";
  if (band === "rare") return "가끔 만남";
  return "처음 만남";
}

// Choosing groups: the ones already in use are offered first, so the same group is not written
// three different ways; a new one can still be typed.
export function GroupPicker({ value, onChange, known, disabled }: { value: string[]; onChange: (next: string[]) => void; known: string[]; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const options = [...new Set([...known, ...value])];
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((g) => g !== name) : [...value, name]);
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (!value.includes(name)) onChange([...value, name]);
    setDraft("");
  };
  return (
    <div className="group-picker" role="group" aria-label="묶음">
      {options.length > 0 && (
        <div className="notes-filter-row">
          {options.map((name) => (
            <button key={name} type="button" className="notes-filter-chip" aria-pressed={value.includes(name)} disabled={disabled} onClick={() => toggle(name)}>{name}</button>
          ))}
        </div>
      )}
      <div className="group-picker-new">
        <input
          className="note-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="새 묶음 — 예: 동아리"
          aria-label="새 묶음 이름"
          maxLength={40}
          disabled={disabled}
        />
        <button type="button" className="note-btn" disabled={disabled || !draft.trim()} onClick={add}>묶음 추가</button>
      </div>
    </div>
  );
}

export type Gender = "male" | "female" | null;
export const GENDER_LABEL: Record<"male" | "female", string> = { male: "남성", female: "여성" };

// Male, female, or left unset. Pressing the chosen one again clears it.
export function GenderPicker({ value, onChange, disabled }: { value: Gender; onChange: (next: Gender) => void; disabled?: boolean }) {
  return (
    <div className="notes-filter-row" role="group" aria-label="성별">
      {(["male", "female"] as const).map((g) => (
        <button key={g} type="button" className="notes-filter-chip" aria-pressed={value === g} disabled={disabled} onClick={() => onChange(value === g ? null : g)}>{GENDER_LABEL[g]}</button>
      ))}
    </div>
  );
}

export async function loadGroupNames(): Promise<string[]> {
  try {
    const body = await apiJson<{ ok: boolean; data?: { groups: Array<{ name: string }> } }>("/api/people/groups");
    return body?.ok && body.data ? body.data.groups.map((g) => g.name) : [];
  } catch {
    return [];
  }
}

// Adding someone by hand. Name is enough; relation and how to reach them are optional.
function AddPerson({ onAdded, startOpen = false, known = [] }: { onAdded: () => void; startOpen?: boolean; known?: string[] }) {
  const [groups, setGroups] = useState<string[]>([]);
  const [gender, setGender] = useState<Gender>(null);
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [channel, setChannel] = useState("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button type="button" className="empty-add-btn people-add-btn" onClick={() => setOpen(true)}>+ 사람 추가</button>;
  }

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name.trim(), channel, ...(relation.trim() ? { relation: relation.trim() } : {}), ...(groups.length > 0 ? { groups } : {}), ...(gender ? { gender } : {}) })
      });
      if (!body?.ok) throw new Error(body?.error?.message ?? "추가하지 못했습니다");
      setName("");
      setRelation("");
      setChannel("none");
      setGroups([]);
      setGender(null);
      setOpen(startOpen);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가하지 못했습니다");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="people-add" aria-label="사람 추가" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input className="note-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="이름" maxLength={100} disabled={saving} autoFocus />
      <input className="note-input" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="설명 (선택) — 어떻게 아는 사이인지" aria-label="관계" maxLength={100} disabled={saving} />
      <select className="note-input" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="연락 채널" disabled={saving}>
        <option value="none">채널 없음</option>
        <option value="kakao">카카오</option>
        <option value="sms">문자</option>
        <option value="email">이메일</option>
        <option value="telegram">텔레그램</option>
      </select>
      <GenderPicker value={gender} onChange={setGender} disabled={saving} />
      <GroupPicker value={groups} onChange={setGroups} known={known} disabled={saving} />
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <div className="people-add-actions">
        {!startOpen && <button type="button" className="note-btn" onClick={() => setOpen(false)} disabled={saving}>취소</button>}
        <button type="submit" className="note-btn note-btn--primary" disabled={!name.trim() || saving}>{saving ? "추가 중…" : "추가"}</button>
      </div>
    </form>
  );
}

export function PeopleDirectory() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  // null until the list is loaded: then it opens on the first view that has anyone in it.
  const [chosenScope, setChosenScope] = useState<Scope | null>(null);
  const [genderFilter, setGenderFilter] = useState<Gender>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const people = view.tag === "live" ? view.people : [];
  const near = useMemo(() => people.filter((p) => p.upcoming || p.recent).sort(byNearness), [people]);
  const pinned = useMemo(() => people.filter((p) => p.pinned), [people]);
  const scope: Scope = chosenScope ?? (near.length > 0 ? "near" : pinned.length > 0 ? "pinned" : "all");
  // Groups in use with how many people each has, most used first.
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of people) for (const g of p.groups ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [people]);
  const ungrouped = people.filter((p) => (p.groups ?? []).length === 0).length;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // A search looks through everyone, whichever view is open.
  const pool = words.length > 0 ? people : scope === "near" ? near : scope === "pinned" ? pinned : people;
  const shown = pool.filter((p) => {
    if (group === "" && (p.groups ?? []).length > 0) return false;
    if (group && !(p.groups ?? []).includes(group)) return false;
    if (genderFilter && p.gender !== genderFilter) return false;
    const text = `${p.name} ${p.relation ?? ""} ${(p.groups ?? []).join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  async function togglePin(person: PersonDirectoryRow) {
    const next = !person.pinned;
    setPinError(null);
    // Shown at once; put back if the server refuses.
    const apply = (value: boolean) => setView((v) => (v.tag === "live" ? { ...v, people: v.people.map((p) => (p.id === person.id ? { ...p, pinned: value } : p)) } : v));
    apply(next);
    try {
      const body = await apiJson<{ ok: boolean; error?: { message?: string } }>(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned: next })
      });
      if (!body?.ok) throw new Error(body?.error?.message ?? "바꾸지 못했습니다");
    } catch (e) {
      apply(!next);
      setPinError(e instanceof Error ? e.message : "바꾸지 못했습니다");
    }
  }

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
          <AddPerson onAdded={() => void load()} />
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" aria-label="사람 목록" data-testid="people-live">
      <div className="people-head">
        <h1 className="section-heading">사람</h1>
        <AddPerson onAdded={() => void load()} known={groupCounts.map(([name]) => name)} />
      </div>
      <div className="notes-filter-row people-scope" role="group" aria-label="보기">
        <button type="button" className="notes-filter-chip" aria-pressed={scope === "near"} onClick={() => setChosenScope("near")}>요즘 {near.length}</button>
        <button type="button" className="notes-filter-chip" aria-pressed={scope === "pinned"} onClick={() => setChosenScope("pinned")}>모아둔 {pinned.length}</button>
        <button type="button" className="notes-filter-chip" aria-pressed={scope === "all"} onClick={() => setChosenScope("all")}>전체 {people.length}</button>
      </div>
      <div className="people-find">
        <input className="note-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름·설명·묶음으로 찾기" aria-label="사람 찾기" />
        {groupCounts.length > 0 && (
          <div className="notes-filter-row" role="group" aria-label="묶음으로 거르기">
            <button type="button" className="notes-filter-chip" aria-pressed={group === null} onClick={() => setGroup(null)}>모든 묶음</button>
            {groupCounts.map(([name, count]) => (
              <button key={name} type="button" className="notes-filter-chip" aria-pressed={group === name} onClick={() => setGroup(group === name ? null : name)}>{name} {count}</button>
            ))}
            {ungrouped > 0 && <button type="button" className="notes-filter-chip" aria-pressed={group === ""} onClick={() => setGroup(group === "" ? null : "")}>묶음 없음 {ungrouped}</button>}
          </div>
        )}
        {people.some((p) => p.gender) && (
          <div className="notes-filter-row" role="group" aria-label="성별로 거르기">
            {(["male", "female"] as const).map((g) => (
              <button key={g} type="button" className="notes-filter-chip" aria-pressed={genderFilter === g} onClick={() => setGenderFilter(genderFilter === g ? null : g)}>
                {GENDER_LABEL[g]} {people.filter((p) => p.gender === g).length}
              </button>
            ))}
          </div>
        )}
        {(words.length > 0 || group !== null || genderFilter !== null) && <p className="note-hint" role="status">{shown.length}명{words.length > 0 && scope !== "all" ? " · 전체에서 찾음" : ""}</p>}
        {pinError && <p className="sheet-error" role="alert">{pinError}</p>}
        {words.length === 0 && group === null && scope === "near" && near.length === 0 && (
          <p className="note-hint">앞뒤 30일 안에 함께하는 일정이 없습니다. 일정 상세에서 참석자를 넣으면 여기에 나옵니다.</p>
        )}
        {words.length === 0 && group === null && scope === "pinned" && pinned.length === 0 && (
          <p className="note-hint">모아둔 사람이 없습니다. 전체에서 ☆ 를 누르면 여기에 모입니다.</p>
        )}
      </div>
      <ul className="person-list" role="list">
        {shown.map((p) => (
          <li key={p.id} className="person-row">
            <button type="button" className="person-pin" aria-pressed={p.pinned === true} onClick={() => void togglePin(p)} aria-label={p.pinned ? `${p.name} 모아둔 사람에서 빼기` : `${p.name} 모아두기`}>
              <span aria-hidden="true">{p.pinned ? "★" : "☆"}</span>
            </button>
            {(p.upcoming || p.recent) && (
              <a className="person-near" data-when={p.upcoming ? "upcoming" : "recent"} href={`/calendar?date=${localDay((p.upcoming ?? p.recent)!.start)}`} aria-label={`${p.name}: ${p.upcoming ? "다가오는" : "지난"} 일정 ${(p.upcoming ?? p.recent)!.title}`}>
                <span className="person-near-tag">{p.upcoming ? "다가옴" : "지난"}</span>
                <span className="person-near-when">{eventWhen((p.upcoming ?? p.recent)!.start)}</span>
                <span className="person-near-title">{(p.upcoming ?? p.recent)!.title}</span>
              </a>
            )}
            <a className="person-card" href={`/people/${p.id}`} aria-label={`${p.name} 상세`}>
              <div className="person-card-name">{p.name}{p.gender && <span className="person-gender">{GENDER_LABEL[p.gender]}</span>}</div>
              {(p.groups ?? []).length > 0 && (
                <div className="person-card-groups">{(p.groups ?? []).map((g) => <span key={g} className="card-chip">{g}</span>)}</div>
              )}
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
