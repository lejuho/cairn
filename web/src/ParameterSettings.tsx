import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DayFeasibility,
  FeasibilityParamLimits,
  FeasibilityParamSettingsData,
  GcalSyncResult,
  GcalSyncStatusData,
  UpdateFeasibilityParamsRequest
} from "@cairn/shared";
import { GcalSyncRunResponseSchema, GcalSyncStatusResponseSchema } from "@cairn/shared";
import { apiJson } from "./api.js";
import { localDateString, localNowRfc3339 } from "./dateUtils.js";

type LoadState = "loading" | "live" | "error";
type GcalPanelState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "live"; data: GcalSyncStatusData; running: boolean; result: GcalSyncResult | null; error: string | null };

const FALLBACK_LIMITS: FeasibilityParamLimits = {
  energyBudget:        { min: 1,    max: 16,  step: 0.5, unit: "h" },
  meetBufferMinutes:   { min: 0,    max: 120, step: 5,   unit: "min" },
  deepBufferMinutes:   { min: 0,    max: 180, step: 5,   unit: "min" },
  travelMargin:        { min: 0.5,  max: 3,   step: 0.1, unit: "x" },
  maxContinuousMinutes:{ min: 60,   max: 960, step: 30,  unit: "min" }
};

const PARAM_LABELS: Record<keyof UpdateFeasibilityParamsRequest, string> = {
  energyBudget: "에너지 예산",
  meetBufferMinutes: "미팅 버퍼",
  deepBufferMinutes: "집중 버퍼",
  travelMargin: "이동 여유",
  maxContinuousMinutes: "최대 연속"
};

const PARAM_KEYS = Object.keys(PARAM_LABELS) as (keyof UpdateFeasibilityParamsRequest)[];

function sameParams(a: UpdateFeasibilityParamsRequest, b: UpdateFeasibilityParamsRequest): boolean {
  return PARAM_KEYS.every((key) => a[key] === b[key]);
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function previewLabel(preview: DayFeasibility): string {
  const suffix = preview.energy.deficit ? " · 초과" : "";
  return `${preview.energy.loadUnits.toFixed(1)}h / ${preview.energy.budgetUnits}h${suffix}`;
}

function gcalStateLabel(data: GcalSyncStatusData): string {
  if (data.state === "connected") return "연결됨";
  if (data.state === "needs_auth") return "인증 필요";
  return "설정 필요";
}

function gcalResultLabel(result: GcalSyncResult): string {
  return `가져옴 ${result.upserted} · 취소 ${result.cancelled} · 건너뜀 ${result.skipped}`;
}

export function ParameterSettings() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [settings, setSettings] = useState<FeasibilityParamSettingsData | null>(null);
  const [draft, setDraft] = useState<UpdateFeasibilityParamsRequest | null>(null);
  const [preview, setPreview] = useState<DayFeasibility | null>(null);
  const [previewState, setPreviewState] = useState<"quiet" | "loading" | "live" | "error">("quiet");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gcal, setGcal] = useState<GcalPanelState>({ tag: "loading" });

  const date = useMemo(() => localDateString(), []);

  const loadGcalStatus = useCallback(async () => {
    setGcal((cur) => cur.tag === "live" ? { ...cur, running: false, error: null } : { tag: "loading" });
    try {
      const body = await apiJson<unknown>("/api/sync/gcal/status");
      const parsed = GcalSyncStatusResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("Google Calendar 상태 응답이 맞지 않아");
      setGcal({ tag: "live", data: parsed.data.data, running: false, result: null, error: null });
    } catch (err: unknown) {
      setGcal({ tag: "error", message: errorMessage(err, "Google Calendar 상태를 불러오지 못했어") });
    }
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    setSaveError(null);
    setPreviewError(null);
    setPreview(null);
    setPreviewState("quiet");
    setSaved(false);
    try {
      const body = await apiJson<{ ok: boolean; data?: FeasibilityParamSettingsData; error?: { message: string } }>("/api/feasibility/params");
      if (!body.ok || !body.data) throw new Error(body.error?.message ?? "파라미터를 불러오지 못했어");
      setSettings(body.data);
      setDraft(body.data.params);
      setLoadState("live");
    } catch (err: unknown) {
      setLoadState("error");
      setSaveError(errorMessage(err, "파라미터를 불러오지 못했어"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadGcalStatus();
  }, [loadGcalStatus]);

  const requestPreview = useCallback(async (next: UpdateFeasibilityParamsRequest) => {
    setPreviewState("loading");
    setPreviewError(null);
    try {
      const body = await apiJson<{ ok: boolean; data?: DayFeasibility; error?: { message: string } }>("/api/feasibility/day/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, now: localNowRfc3339(), params: next })
      });
      if (!body.ok || !body.data) throw new Error(body.error?.message ?? "미리보기를 계산하지 못했어");
      setPreview(body.data);
      setPreviewState("live");
    } catch (err: unknown) {
      setPreview(null);
      setPreviewState("error");
      setPreviewError(errorMessage(err, "미리보기를 계산하지 못했어"));
    }
  }, [date]);

  const handleSliderChange = useCallback((key: keyof UpdateFeasibilityParamsRequest, value: number) => {
    if (!draft) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    setSaved(false);
    setSaveError(null);
    void requestPreview(next);
  }, [draft, requestPreview]);

  const handleResetDefaults = useCallback(() => {
    if (!settings) return;
    setDraft(settings.defaults);
    setSaved(false);
    setSaveError(null);
    void requestPreview(settings.defaults);
  }, [requestPreview, settings]);

  const handleSave = useCallback(async () => {
    if (!draft || !settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = await apiJson<{ ok: boolean; error?: { message: string } }>("/api/feasibility/params", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!body.ok) throw new Error(body.error?.message ?? "저장하지 못했어");
      setSettings({ ...settings, params: draft });
      setSaved(true);
    } catch (err: unknown) {
      setSaveError(errorMessage(err, "저장하지 못했어"));
    } finally {
      setSaving(false);
    }
  }, [draft, settings]);

  const handleRunGcalSync = useCallback(async () => {
    if (gcal.tag !== "live" || gcal.running || gcal.data.state !== "connected") return;
    setGcal({ ...gcal, running: true, error: null, result: null });
    try {
      const body = await apiJson<unknown>("/api/sync/gcal/run", { method: "POST" });
      const parsed = GcalSyncRunResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("Google Calendar 동기화 응답이 맞지 않아");
      setGcal({
        tag: "live",
        data: parsed.data.data.status,
        running: false,
        result: parsed.data.data.result,
        error: null
      });
    } catch (err: unknown) {
      setGcal((cur) => cur.tag === "live"
        ? { ...cur, running: false, error: errorMessage(err, "Google Calendar 동기화에 실패했어") }
        : cur);
    }
  }, [gcal]);

  if (loadState === "loading") {
    return (
      <main className="params-page" aria-labelledby="params-title">
        <header className="params-header">
          <p className="eyebrow">feasibility</p>
          <h1 id="params-title">파라미터</h1>
        </header>
        <section className="params-card" aria-label="파라미터 불러오는 중" data-testid="params-loading">
          {PARAM_KEYS.map((key) => (
            <div className="params-skeleton-row" key={key}>
              <span />
              <strong />
            </div>
          ))}
        </section>
      </main>
    );
  }

  if (loadState === "error" || !settings || !draft) {
    return (
      <main className="params-page" aria-labelledby="params-title">
        <header className="params-header">
          <p className="eyebrow">feasibility</p>
          <h1 id="params-title">파라미터</h1>
        </header>
        <section className="params-error" role="alert" data-testid="params-error">
          <h2>파라미터를 못 불러왔어</h2>
          <p>{saveError ?? "네트워크나 서버 상태를 확인해줘."}</p>
          <button type="button" onClick={() => void load()}>다시 시도</button>
        </section>
      </main>
    );
  }

  const limits = settings.limits ?? FALLBACK_LIMITS;
  const dirty = !sameParams(draft, settings.params);

  return (
    <main className="params-page" aria-labelledby="params-title" data-testid="params-live">
      <header className="params-header">
        <div>
          <p className="eyebrow">feasibility</p>
          <h1 id="params-title">파라미터</h1>
        </div>
        <span className="params-date">{date}</span>
      </header>

      <section className="params-card" aria-label="체력 파라미터">
        <div className="feas-settings-body">
          {PARAM_KEYS.map((key) => {
            const lim = limits[key];
            const val = draft[key];
            return (
              <div key={key} className="feas-param-row">
                <label className="feas-param-label" htmlFor={`params-slider-${key}`}>
                  {PARAM_LABELS[key]}
                  <span className="feas-param-unit">{lim.unit}</span>
                </label>
                <div className="feas-param-control">
                  <input
                    id={`params-slider-${key}`}
                    type="range"
                    className="feas-slider"
                    min={lim.min}
                    max={lim.max}
                    step={lim.step}
                    value={val}
                    onChange={(e) => handleSliderChange(key, Number(e.target.value))}
                    disabled={saving}
                    aria-label={`${PARAM_LABELS[key]} ${val}${lim.unit}`}
                  />
                  <span className="feas-param-val">{val}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="params-preview" aria-live="polite">
          <span className="params-preview-label">미리보기</span>
          {previewState === "quiet" && <span className="params-preview-value">변경하면 계산할게</span>}
          {previewState === "loading" && <span className="params-preview-value">계산 중...</span>}
          {previewState === "live" && preview && <span className="params-preview-value">{previewLabel(preview)}</span>}
          {previewState === "error" && <span className="params-preview-error">{previewError}</span>}
        </div>

        {saveError && <p className="params-inline-error" role="alert">{saveError}</p>}
        {saved && !dirty && <p className="params-saved" role="status">저장됐어</p>}

        <div className="params-actions">
          <button
            type="button"
            className="params-secondary-btn"
            onClick={handleResetDefaults}
            disabled={saving}
          >
            기본값
          </button>
          <button
            type="button"
            className="params-primary-btn"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            aria-label="파라미터 저장"
          >
            {saving ? "저장 중..." : "적용"}
          </button>
        </div>
      </section>

      <GcalSyncCard state={gcal} onRefresh={() => void loadGcalStatus()} onRun={() => void handleRunGcalSync()} />
    </main>
  );
}

function GcalSyncCard({ state, onRefresh, onRun }: {
  state: GcalPanelState;
  onRefresh: () => void;
  onRun: () => void;
}) {
  return (
    <section className="params-card gcal-sync-card" aria-labelledby="gcal-sync-title" data-testid="gcal-sync-card">
      <div className="gcal-sync-head">
        <div>
          <p className="eyebrow">sync</p>
          <h2 id="gcal-sync-title">Google Calendar</h2>
        </div>
        {state.tag === "live" && (
          <span className={`gcal-sync-pill gcal-sync-pill--${state.data.state}`}>{gcalStateLabel(state.data)}</span>
        )}
      </div>

      {state.tag === "loading" && (
        <div className="gcal-sync-loading" data-testid="gcal-sync-loading">
          <span />
          <strong />
        </div>
      )}

      {state.tag === "error" && (
        <div className="gcal-sync-error" role="alert" data-testid="gcal-sync-error">
          <p>{state.message}</p>
          <button type="button" className="params-secondary-btn" onClick={onRefresh}>다시 확인</button>
        </div>
      )}

      {state.tag === "live" && (
        <>
          <dl className="gcal-sync-facts">
            <div>
              <dt>상태</dt>
              <dd>{state.data.message}</dd>
            </div>
            <div>
              <dt>마지막 동기화</dt>
              <dd>{state.data.lastSyncAt ?? "아직 없음"}</dd>
            </div>
            <div>
              <dt>토큰</dt>
              <dd>{state.data.tokenPresent ? "있음" : "없음"}</dd>
            </div>
          </dl>

          {state.result && <p className="params-saved" role="status">{gcalResultLabel(state.result)}</p>}
          {state.error && <p className="params-inline-error" role="alert">{state.error}</p>}

          <div className="params-actions">
            <button type="button" className="params-secondary-btn" onClick={onRefresh} disabled={state.running}>상태 확인</button>
            <button
              type="button"
              className="params-primary-btn"
              onClick={onRun}
              disabled={state.running || state.data.state !== "connected"}
              aria-label="Google Calendar 지금 동기화"
            >
              {state.running ? "동기화 중..." : "지금 동기화"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
