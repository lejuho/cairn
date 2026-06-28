import type { SourceStability } from "@cairn/shared";
import { apiJson } from "./api.js";

// Watcher + Record Composer modes (cycle-71). Shared between /input and /today.
// This module holds the dedicated DATA LAYER (createWatcher/createRecord call
// apiJson) AND the presentational field panels (WatcherFields/RecordTargetSelect,
// data-in/callbacks-out, NO apiJson). The shared CreationComposer stays pure.

// ── watcher ───────────────────────────────────────────────────────────────────

export type WatcherSubtype = "date_threshold" | "reverse_plan" | "manual_exogenous";
export type WatcherStep = { label: string; leadDays: string };
export type WatcherFields = {
  category: string;
  threshold: string; // date_threshold
  targetDate: string; // reverse_plan
  targetLabel: string;
  safetyDays: string;
  steps: WatcherStep[];
  sourceLabel: string; // manual_exogenous
  sourceUrl: string;
  sourceStability: SourceStability;
};
export const EMPTY_WATCHER_FIELDS: WatcherFields = {
  category: "", threshold: "", targetDate: "", targetLabel: "", safetyDays: "0",
  steps: [{ label: "", leadDays: "1" }], sourceLabel: "", sourceUrl: "", sourceStability: "unknown"
};
export const WATCHER_SUBTYPES: { key: WatcherSubtype; label: string }[] = [
  { key: "date_threshold", label: "날짜 기반" },
  { key: "reverse_plan", label: "역산 계획" },
  { key: "manual_exogenous", label: "수동 확인" }
];
const MAX_STEPS = 8; // matches the existing reverse-plan route bound

// Pure validity — `label` is the Composer central text (always required separately).
export function watcherSubtypeValid(subtype: WatcherSubtype, f: WatcherFields): boolean {
  if (subtype === "date_threshold") return f.threshold !== "";
  if (subtype === "reverse_plan") return f.targetDate !== "" && f.steps.some((s) => s.label.trim() !== "");
  return true; // manual_exogenous needs only the label
}

// Data layer: build the exact existing request shape per subtype and POST it.
export async function createWatcher(subtype: WatcherSubtype, label: string, f: WatcherFields): Promise<void> {
  const category = f.category.trim();
  if (subtype === "date_threshold") {
    const body = { label, threshold: f.threshold, ...(category ? { category } : {}) };
    const r = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.error?.message ?? "생성 실패");
  } else if (subtype === "reverse_plan") {
    const safetyDays = Math.max(0, Math.min(30, parseInt(f.safetyDays, 10) || 0));
    const steps = f.steps.filter((s) => s.label.trim() !== "").map((s) => ({ label: s.label.trim(), leadDays: Math.max(0, Math.min(365, parseInt(s.leadDays, 10) || 0)) }));
    const body = { label, targetDate: f.targetDate, ...(category ? { category } : {}), ...(f.targetLabel.trim() ? { targetLabel: f.targetLabel.trim() } : {}), safetyDays, steps };
    const r = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers/reverse-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.error?.message ?? "생성 실패");
  } else {
    const body = { label, ...(category ? { category } : {}), ...(f.sourceLabel.trim() ? { sourceLabel: f.sourceLabel.trim() } : {}), ...(f.sourceUrl.trim() ? { sourceUrl: f.sourceUrl.trim() } : {}), sourceStability: f.sourceStability };
    const r = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/watchers/manual-exogenous", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.error?.message ?? "생성 실패");
  }
}

// ── record (event-linked annotation) ─────────────────────────────────────────

export type RecordTarget = { id: number; title: string };

export function dedupeTargets(events: { id: number; title?: string | null }[]): RecordTarget[] {
  const seen = new Set<number>();
  const out: RecordTarget[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ id: e.id, title: e.title?.trim() ? e.title : `이벤트 #${e.id}` });
  }
  return out;
}

export async function createRecord(eventId: number, text: string): Promise<{ parseStatus: "parsed" | "raw_stored" }> {
  const r = await apiJson<{ ok: boolean; data?: { parseStatus: "parsed" | "raw_stored" }; error?: { message: string } }>(`/api/events/${eventId}/annotations`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
  });
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? "기록 실패");
  return { parseStatus: r.data.parseStatus };
}

// ── presentational panels (NO apiJson) ───────────────────────────────────────

const STABILITY_LABELS: { key: SourceStability; label: string }[] = [
  { key: "unknown", label: "모름" }, { key: "stable", label: "안정" }, { key: "volatile", label: "자주 변함" }
];

export function WatcherFieldsPanel({
  subtype, fields, onSubtypeChange, onFieldsChange
}: {
  subtype: WatcherSubtype;
  fields: WatcherFields;
  onSubtypeChange: (s: WatcherSubtype) => void;
  onFieldsChange: (patch: Partial<WatcherFields>) => void;
}) {
  return (
    <div className="composer-detail" data-testid="watcher-fields">
      <div className="composer-subtypes" role="group" aria-label="Watcher 종류">
        {WATCHER_SUBTYPES.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`composer-subtype${subtype === s.key ? " composer-subtype--active" : ""}`}
            aria-pressed={subtype === s.key}
            data-subtype={s.key}
            onClick={() => onSubtypeChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {subtype === "date_threshold" && (
        <label className="composer-field">
          <span>마감일</span>
          <input type="date" className="composer-field-input" aria-label="watcher 마감일"
            value={fields.threshold} onChange={(e) => onFieldsChange({ threshold: e.target.value })} />
        </label>
      )}

      {subtype === "reverse_plan" && (
        <>
          <label className="composer-field">
            <span>목표 날짜</span>
            <input type="date" className="composer-field-input" aria-label="목표 날짜"
              value={fields.targetDate} onChange={(e) => onFieldsChange({ targetDate: e.target.value })} />
          </label>
          <label className="composer-field">
            <span>여유 일수</span>
            <input type="number" min={0} max={30} className="composer-field-input" aria-label="여유 일수"
              value={fields.safetyDays} onChange={(e) => onFieldsChange({ safetyDays: e.target.value })} />
          </label>
          <div className="composer-steps">
            {fields.steps.map((step, i) => (
              <div key={i} className="composer-step-row">
                <input className="composer-field-input" aria-label={`단계 ${i + 1} 이름`} placeholder={`단계 ${i + 1}`}
                  value={step.label} onChange={(e) => onFieldsChange({ steps: fields.steps.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)) })} />
                <input type="number" min={0} max={365} className="composer-field-input composer-step-lead" aria-label={`단계 ${i + 1} 며칠 전`}
                  value={step.leadDays} onChange={(e) => onFieldsChange({ steps: fields.steps.map((s, j) => (j === i ? { ...s, leadDays: e.target.value } : s)) })} />
                {fields.steps.length > 1 && (
                  <button type="button" className="composer-step-remove" aria-label={`단계 ${i + 1} 삭제`}
                    onClick={() => onFieldsChange({ steps: fields.steps.filter((_, j) => j !== i) })}>×</button>
                )}
              </div>
            ))}
            {fields.steps.length < MAX_STEPS && (
              <button type="button" className="composer-step-add" onClick={() => onFieldsChange({ steps: [...fields.steps, { label: "", leadDays: "1" }] })}>+ 단계 추가</button>
            )}
          </div>
        </>
      )}

      {subtype === "manual_exogenous" && (
        <>
          <label className="composer-field">
            <span>출처 이름</span>
            <input className="composer-field-input" aria-label="출처 이름"
              value={fields.sourceLabel} onChange={(e) => onFieldsChange({ sourceLabel: e.target.value })} />
          </label>
          <label className="composer-field">
            <span>출처 URL</span>
            <input className="composer-field-input" aria-label="출처 URL"
              value={fields.sourceUrl} onChange={(e) => onFieldsChange({ sourceUrl: e.target.value })} />
          </label>
          <label className="composer-field">
            <span>안정성</span>
            <select className="composer-field-input" aria-label="출처 안정성"
              value={fields.sourceStability} onChange={(e) => onFieldsChange({ sourceStability: e.target.value as SourceStability })}>
              {STABILITY_LABELS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export function RecordTargetSelect({
  targets, selectedId, onSelect
}: {
  targets: RecordTarget[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (targets.length === 0) {
    return <p className="composer-detail composer-detail-empty" data-testid="record-no-target">기록할 이벤트가 없어.</p>;
  }
  return (
    <label className="composer-field composer-detail" data-testid="record-target">
      <span>기록할 이벤트</span>
      <select className="composer-field-input" aria-label="기록할 이벤트"
        value={selectedId ?? ""} onChange={(e) => onSelect(Number(e.target.value))}>
        <option value="" disabled>이벤트 선택</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
      </select>
    </label>
  );
}
