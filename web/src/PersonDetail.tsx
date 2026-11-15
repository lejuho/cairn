import { useEffect, useRef, useState } from "react";
import type { AuthoredPreferredWindows, EgoGraphData, EventRow, NoteView, PersonDirectoryRow, PersonRow, PreferredPeriod, Weekday } from "@cairn/shared";
import { apiJson, openAccessLogin } from "./api.js";
import type { AccessSessionError } from "./api.js";
import { EgoSheet, loadEgoGraph } from "./EgoSheet.js";
import { formatLastMet } from "./lastMet.js";
import { GENDER_LABEL, GenderPicker, GroupPicker, loadGroupNames, type Gender } from "./PeopleDirectory.js";
import { AttachedNotes } from "./Notes.js";

type ViewState =
  | { tag: "loading" }
  | { tag: "live"; person: PersonDirectoryRow; recentMeetings: EventRow[]; notes: NoteView[] }
  | { tag: "not_found" }
  | { tag: "error"; message: string }
  | { tag: "access_error" };

type SheetState = {
  open: boolean;
  preferredWeekdays: Weekday[];
  preferredPeriods: PreferredPeriod[];
  leadTimeDays: number | null;
  channel: PersonRow["channel"];
  unavailableWeekdays: Weekday[];
  saving: boolean;
  saveError: string | null;
};

const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_KO: Record<Weekday, string> = {
  monday: "월", tuesday: "화", wednesday: "수", thursday: "목",
  friday: "금", saturday: "토", sunday: "일"
};
const PERIODS: PreferredPeriod[] = ["morning", "afternoon", "evening"];
const PERIOD_KO: Record<PreferredPeriod, string> = { morning: "오전", afternoon: "오후", evening: "저녁" };
const LEAD_TIME_OPTIONS: Array<{ days: number | null; label: string }> = [
  { days: null, label: "설정 없음" },
  { days: 0, label: "당일" },
  { days: 1, label: "1일" },
  { days: 3, label: "3일" },
  { days: 7, label: "7일" },
  { days: 14, label: "14일" },
  { days: 30, label: "30일" }
];
const CHANNELS: Array<{ value: PersonRow["channel"]; label: string }> = [
  { value: "none", label: "없음" },
  { value: "kakao", label: "카카오톡" },
  { value: "sms", label: "문자" },
  { value: "email", label: "이메일" },
  { value: "telegram", label: "텔레그램" }
];

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

function leadTimeLabel(days: number | null): string {
  if (days === null) return "설정 없음";
  if (days === 0) return "당일";
  return `${days}일 전`;
}

function buildInitialSheet(person: PersonRow): Omit<SheetState, "open" | "saving" | "saveError"> {
  const win: AuthoredPreferredWindows | null | undefined = person.preferredWindows;
  return {
    preferredWeekdays: win?.weekdays ?? [],
    preferredPeriods: win?.periods ?? [],
    leadTimeDays: person.leadTime?.days ?? null,
    channel: person.channel ?? "none",
    unavailableWeekdays: (person.hardConstraints ?? [])
      .filter((c) => c.type === "weekday_unavailable")
      .map((c) => c.weekday)
  };
}

type PersonEgoState =
  | { tag: "closed" }
  | { tag: "loading" }
  | { tag: "open"; graph: EgoGraphData }
  | { tag: "error" };

// Name, how you know them, groups and channel — the things written when the person was added.
function PersonBasicsForm({ person, onCancel, onSaved }: { person: PersonRow; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(person.name);
  const [relation, setRelation] = useState(person.relation ?? "");
  const [channel, setChannel] = useState<string>(person.channel ?? "none");
  const [groups, setGroups] = useState<string[]>(person.groups ?? []);
  const [gender, setGender] = useState<Gender>(person.gender ?? null);
  const [known, setKnown] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting: asked twice, and once more with what would be unhooked when the person is still in use.
  const [removing, setRemoving] = useState<"idle" | "ask" | { events: number; notes: number; resources: number }>("idle");

  const remove = async (force: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${person.id}${force ? "?force=1" : ""}`, { method: "DELETE" });
      const body = (await res.json()) as { ok: boolean; data?: { usage?: { events: number; notes: number; resources: number } }; error?: { code?: string; message?: string } };
      if (body.ok) {
        window.location.assign("/people");
        return;
      }
      if (body.error?.code === "IN_USE" && body.data?.usage) setRemoving(body.data.usage);
      else setError(body.error?.message ?? "지우지 못했습니다");
    } catch {
      setError("지우지 못했습니다");
    }
    setSaving(false);
  };

  useEffect(() => {
    let alive = true;
    void loadGroupNames().then((names) => alive && setKnown(names));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = await apiJson<{ ok: boolean; error?: { message?: string } }>(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), relation: relation.trim() === "" ? null : relation.trim(), channel, groups, gender })
      });
      if (!body?.ok) throw new Error(body?.error?.message ?? "저장하지 못했습니다");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다");
      setSaving(false);
    }
  };

  return (
    <form className="people-add person-basics-form" aria-label="사람 고치기" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="thread-node-field"><span>이름</span>
        <input className="note-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="이름" maxLength={100} disabled={saving} />
      </label>
      <label className="thread-node-field"><span>설명</span>
        <textarea className="note-input person-basics-text" rows={2} value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="설명" maxLength={500} disabled={saving} placeholder="어떻게 아는 사이인지, 기억해 둘 것" />
      </label>
      <div className="thread-node-field"><span>성별</span>
        <GenderPicker value={gender} onChange={setGender} disabled={saving} />
      </div>
      <div className="thread-node-field"><span>묶음</span>
        <GroupPicker value={groups} onChange={setGroups} known={known} disabled={saving} />
      </div>
      <label className="thread-node-field"><span>연락 채널</span>
        <select className="note-input" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="연락 채널 고르기" disabled={saving}>
          <option value="none">채널 없음</option>
          <option value="kakao">카카오</option>
          <option value="sms">문자</option>
          <option value="email">이메일</option>
          <option value="telegram">텔레그램</option>
        </select>
      </label>
      {error && <p className="sheet-error" role="alert">{error}</p>}
      <div className="people-add-actions">
        <button type="button" className="note-btn" onClick={onCancel} disabled={saving}>취소</button>
        <button type="submit" className="note-btn note-btn--primary" disabled={!name.trim() || saving}>{saving ? "저장 중…" : "저장"}</button>
      </div>
      <div className="person-remove">
        {removing === "idle" && <button type="button" className="note-text-btn" onClick={() => setRemoving("ask")} disabled={saving}>이 사람 지우기</button>}
        {removing === "ask" && (
          <>
            <button type="button" className="note-text-btn note-text-btn--danger" onClick={() => void remove(false)} disabled={saving}>정말 지우기</button>
            <button type="button" className="note-text-btn" onClick={() => setRemoving("idle")} disabled={saving}>그만두기</button>
          </>
        )}
        {typeof removing === "object" && (
          <div role="alert" className="person-remove-warn">
            <p>
              {[removing.events > 0 ? `일정 ${removing.events}건` : null, removing.notes > 0 ? `메모 ${removing.notes}건` : null, removing.resources > 0 ? `자원 ${removing.resources}건` : null].filter(Boolean).join(", ")}에 연결돼 있습니다.
              지우면 연결만 끊기고 일정과 메모는 남습니다.
            </p>
            <button type="button" className="note-text-btn note-text-btn--danger" onClick={() => void remove(true)} disabled={saving}>연결 끊고 지우기</button>
            <button type="button" className="note-text-btn" onClick={() => setRemoving("idle")} disabled={saving}>그만두기</button>
          </div>
        )}
      </div>
    </form>
  );
}

export function PersonDetail({ id }: { id: number }) {
  const [view, setView] = useState<ViewState>({ tag: "loading" });
  const [egoState, setEgoState] = useState<PersonEgoState>({ tag: "closed" });
  const [editingBasics, setEditingBasics] = useState(false);
  const reloadPerson = () => void load();
  const [sheet, setSheet] = useState<SheetState>({
    open: false,
    preferredWeekdays: [],
    preferredPeriods: [],
    leadTimeDays: null,
    channel: "none",
    unavailableWeekdays: [],
    saving: false,
    saveError: null
  });
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);

  async function load() {
    setView({ tag: "loading" });
    const now = new Date().toISOString();
    try {
      const body = await apiJson<{ ok: boolean; data?: { person: PersonDirectoryRow; recentMeetings: EventRow[]; notes?: NoteView[] }; error?: { code?: string; message: string } }>(
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
      setView({ tag: "live", person: body.data!.person, recentMeetings: body.data!.recentMeetings, notes: Array.isArray(body.data!.notes) ? body.data!.notes : [] });
    } catch (e) {
      if ((e as AccessSessionError).kind === "access_session_required") {
        setView({ tag: "access_error" });
      } else {
        setView({ tag: "error", message: e instanceof Error ? e.message : "불러오기 실패" });
      }
    }
  }

  useEffect(() => { void load(); }, [id]);

  // Escape and focus-restore on sheet close. Blocked while saving (ISSUE-4).
  useEffect(() => {
    if (!sheet.open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sheet.saving) closeSheet();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet.open, sheet.saving]);

  function openSheet(person: PersonRow) {
    setSheet({ open: true, ...buildInitialSheet(person), saving: false, saveError: null });
    requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  function closeSheet() {
    setSheet((s) => ({ ...s, open: false, saving: false, saveError: null }));
    // Restore focus to the button that opened the sheet (ISSUE-5).
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  // Focus-trap helpers (sentinel-div approach — ISSUE-5).
  function onStartSentinelFocus() {
    // Tab backward from start: wrap to last focusable in dialog.
    const dialog = backdropRef.current?.querySelector("[role='dialog']");
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [tabindex='0']:not([tabindex='-1'])"
    ));
    const last = focusable.filter((el) => el !== startSentinelRef.current && el !== endSentinelRef.current).at(-1);
    last?.focus();
  }

  function onEndSentinelFocus() {
    // Tab forward from end: wrap to first focusable in dialog.
    const dialog = backdropRef.current?.querySelector("[role='dialog']");
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [tabindex='0']:not([tabindex='-1'])"
    ));
    const first = focusable.filter((el) => el !== startSentinelRef.current && el !== endSentinelRef.current)[0];
    first?.focus();
  }

  function togglePreferredWeekday(day: Weekday) {
    setSheet((s) => {
      const has = s.preferredWeekdays.includes(day);
      const next = has
        ? s.preferredWeekdays.filter((d) => d !== day)
        : [...s.preferredWeekdays, day];
      // Clear same day from unavailable (mutual exclusion)
      const nextUnavail = has ? s.unavailableWeekdays : s.unavailableWeekdays.filter((d) => d !== day);
      return { ...s, preferredWeekdays: next, unavailableWeekdays: nextUnavail };
    });
  }

  function toggleUnavailableWeekday(day: Weekday) {
    setSheet((s) => {
      const has = s.unavailableWeekdays.includes(day);
      const next = has
        ? s.unavailableWeekdays.filter((d) => d !== day)
        : [...s.unavailableWeekdays, day];
      // Clear same day from preferred (mutual exclusion)
      const nextPref = has ? s.preferredWeekdays : s.preferredWeekdays.filter((d) => d !== day);
      return { ...s, unavailableWeekdays: next, preferredWeekdays: nextPref };
    });
  }

  function togglePeriod(p: PreferredPeriod) {
    setSheet((s) => {
      const has = s.preferredPeriods.includes(p);
      return { ...s, preferredPeriods: has ? s.preferredPeriods.filter((x) => x !== p) : [...s.preferredPeriods, p] };
    });
  }

  async function saveSheet() {
    setSheet((s) => ({ ...s, saving: true, saveError: null }));
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>(
        `/api/people/${id}/profile`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferredWeekdays: sheet.preferredWeekdays,
            preferredPeriods: sheet.preferredPeriods,
            leadTimeDays: sheet.leadTimeDays,
            channel: sheet.channel,
            unavailableWeekdays: sheet.unavailableWeekdays
          })
        }
      );
      if (!body.ok) {
        setSheet((s) => ({ ...s, saving: false, saveError: body.error?.message ?? "저장 실패" }));
        return;
      }
      setSheet((s) => ({ ...s, open: false, saving: false, saveError: null }));
      await load();
    } catch (e) {
      setSheet((s) => ({
        ...s,
        saving: false,
        saveError: e instanceof Error ? e.message : "저장 실패"
      }));
    }
  }

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

  if (view.tag === "not_found") {
    return (
      <main className="app-shell" aria-label="사람 상세" data-testid="person-not-found">
        <section className="quiet-card warm">
          <h1>사람을 찾을 수 없습니다</h1>
          <p>이미 삭제됐거나 잘못된 링크일 수 있습니다.</p>
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
  const win = person.preferredWindows ?? null;
  const lt = person.leadTime ?? null;

  return (
    <main className="app-shell" aria-label="사람 상세" data-testid="person-live">
      {/* Page content made inert while the sheet is open (ISSUE-5). */}
      <div inert={sheet.open || egoState.tag === "open" || undefined} data-testid="page-content">
      <a className="back-link" href="/people">← 사람 목록</a>
      <header className="person-detail-header">
        <h1 className="person-detail-name">{person.name}{person.gender && <span className="person-gender">{GENDER_LABEL[person.gender]}</span>}</h1>
        {!editingBasics && (person.groups ?? []).length > 0 && (
          <p className="person-card-groups" aria-label="묶음">{(person.groups ?? []).map((g) => <span key={g} className="card-chip">{g}</span>)}</p>
        )}
        {!editingBasics && person.relation && <p className="person-detail-relation">{person.relation}</p>}
        {!editingBasics && person.channel && person.channel !== "none" && (
          <p className="person-detail-channel" aria-label="연락 채널">{person.channel}</p>
        )}
        {editingBasics
          ? <PersonBasicsForm person={person} onCancel={() => setEditingBasics(false)} onSaved={() => { setEditingBasics(false); reloadPerson(); }} />
          : <button type="button" className="note-text-btn" onClick={() => setEditingBasics(true)} aria-label="이름·설명·묶음 고치기">고치기</button>}
      </header>

      <section className="person-detail-memory" aria-label="관계 기억">
        <h2>관계 기억</h2>
        <dl className="person-stats">
          <div><dt>총 만남</dt><dd>{person.totalMeets}회</dd></div>
          <div><dt>마지막 만남</dt><dd>{formatLastMet(person.lastMet)}</dd></div>
          <div><dt>빈도</dt><dd>{frequencyLabel(person.frequencyBand)}</dd></div>
        </dl>
      </section>

      <section className="person-detail-ego" aria-label="작은 관계">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <h2 style={{ margin: 0 }}>작은 관계</h2>
          <button
            className="action-btn action-btn--sm"
            data-testid="person-ego-btn"
            disabled={egoState.tag === "loading"}
            onClick={async () => {
              setEgoState({ tag: "loading" });
              const graph = await loadEgoGraph("person", id);
              setEgoState(graph ? { tag: "open", graph } : { tag: "error" });
            }}
          >
            {egoState.tag === "loading" ? "불러오는 중…" : "보기"}
          </button>
          {egoState.tag === "error" && <span className="card-meta" style={{ color: "var(--color-error)" }}>불러오기 실패</span>}
        </div>
      </section>

      <section className="person-detail-profile" aria-label="취급 프로필">
        <div className="person-detail-profile-header">
          <h2>취급 프로필</h2>
          <button ref={openerRef} className="action-btn action-btn--sm" onClick={() => openSheet(person)} aria-label="프로필 편집">
            프로필 편집
          </button>
        </div>
        <dl className="person-stats">
          <div>
            <dt>선호 요일</dt>
            <dd data-testid="profile-preferred-days">
              {win?.weekdays?.length ? win.weekdays.map((d) => WEEKDAY_KO[d]).join(", ") : "설정 없음"}
            </dd>
          </div>
          <div>
            <dt>선호 시간대</dt>
            <dd data-testid="profile-preferred-periods">
              {win?.periods?.length ? win.periods.map((p) => PERIOD_KO[p]).join(", ") : "설정 없음"}
            </dd>
          </div>
          <div>
            <dt>연락 채널</dt>
            <dd data-testid="profile-channel">
              {person.channel && person.channel !== "none" ? CHANNELS.find((c) => c.value === person.channel)?.label ?? person.channel : "설정 없음"}
            </dd>
          </div>
          <div>
            <dt>최소 사전 통보</dt>
            <dd data-testid="profile-lead-time">{leadTimeLabel(lt?.days ?? null)}</dd>
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

      <AttachedNotes
        key={person.id}
        title="이 사람 메모"
        initial={view.notes}
        target={{ targetType: "person", targetId: person.id, label: person.name, when: null, status: null, exists: true }}
      />

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
          <p className="person-quiet">기록된 만남 없음</p>
        )}
      </section>
      </div>{/* end inert page-content wrapper */}

      {egoState.tag === "open" && (
        <EgoSheet graph={egoState.graph} onClose={() => setEgoState({ tag: "closed" })} />
      )}

      {sheet.open && (
        <div
          className="sheet-backdrop"
          data-testid="profile-sheet"
          ref={backdropRef}
          role="presentation"
          onClick={(e) => {
            // Block backdrop dismissal while saving (ISSUE-4).
            if (!sheet.saving && e.target === backdropRef.current) closeSheet();
          }}
        >
          {/* Start focus-trap sentinel (ISSUE-5): Tab-backward from first child wraps to last. */}
          <div ref={startSentinelRef} tabIndex={0} aria-hidden="true" onFocus={onStartSentinelFocus} style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />
          <div
            className="bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="프로필 편집"
            aria-describedby="sheet-desc"
          >
            <div className="sheet-header">
              <h2 id="sheet-desc">프로필 편집</h2>
              {/* Close blocked while saving (ISSUE-4). */}
              <button ref={closeButtonRef} className="sheet-close" aria-label="닫기" onClick={() => { if (!sheet.saving) closeSheet(); }} disabled={sheet.saving}>✕</button>
            </div>

            <div className="sheet-body">
              <fieldset className="sheet-fieldset">
                <legend>선호 요일</legend>
                <div className="toggle-row">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className="day-toggle"
                      aria-pressed={sheet.preferredWeekdays.includes(day)}
                      onClick={() => togglePreferredWeekday(day)}
                    >
                      {WEEKDAY_KO[day]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="sheet-fieldset">
                <legend>선호 시간대</legend>
                <div className="toggle-row">
                  {PERIODS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="period-toggle"
                      aria-pressed={sheet.preferredPeriods.includes(p)}
                      onClick={() => togglePeriod(p)}
                    >
                      {PERIOD_KO[p]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="sheet-fieldset">
                <legend>최소 사전 통보</legend>
                <div className="chip-row">
                  {LEAD_TIME_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      className="lead-chip"
                      aria-pressed={sheet.leadTimeDays === opt.days}
                      onClick={() => setSheet((s) => ({ ...s, leadTimeDays: opt.days }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="sheet-fieldset">
                <legend>연락 채널</legend>
                <div className="chip-row">
                  {CHANNELS.map((c) => (
                    <button
                      key={String(c.value)}
                      type="button"
                      className="channel-chip"
                      aria-pressed={sheet.channel === c.value}
                      onClick={() => setSheet((s) => ({ ...s, channel: c.value }))}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="sheet-fieldset">
                <legend>만나기 어려운 요일</legend>
                <div className="toggle-row">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      className="day-toggle"
                      aria-pressed={sheet.unavailableWeekdays.includes(day)}
                      onClick={() => toggleUnavailableWeekday(day)}
                    >
                      {WEEKDAY_KO[day]}
                    </button>
                  ))}
                </div>
              </fieldset>

              {sheet.saveError && (
                <p role="alert" className="sheet-error">{sheet.saveError}</p>
              )}

              <div className="sheet-actions">
                <button className="action-btn" onClick={() => void saveSheet()} disabled={sheet.saving} aria-busy={sheet.saving}>
                  {sheet.saving ? "저장 중…" : "저장"}
                </button>
                <button className="action-btn action-btn--ghost" onClick={closeSheet} disabled={sheet.saving}>
                  취소
                </button>
              </div>
            </div>
          </div>
          {/* End focus-trap sentinel: Tab-forward from last child wraps to first. */}
          <div ref={endSentinelRef} tabIndex={0} aria-hidden="true" onFocus={onEndSentinelFocus} style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />
        </div>
      )}
    </main>
  );
}
