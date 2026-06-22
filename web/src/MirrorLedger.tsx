import { useEffect, useState } from "react";
import type {
  MirrorLedgerData,
  MirrorLedgerEntry,
  MirrorPatternBucket,
  MirrorPatternThreadBucket,
  MirrorPatternsData
} from "@cairn/shared";
import { apiJson, type AccessSessionError } from "./api.js";

type MirrorData = { ledger: MirrorLedgerData; patterns: MirrorPatternsData };

type ViewState =
  | { tag: "loading" }
  | { tag: "quiet"; data: MirrorData }
  | { tag: "live"; data: MirrorData }
  | { tag: "error"; message: string }
  | { tag: "access_session_required" };

async function loadMirrorData(): Promise<MirrorData> {
  const [ledgerBody, patternsBody] = await Promise.all([
    apiJson<{ ok: boolean; data?: MirrorLedgerData; error?: { message: string } }>("/api/mirror/ledger"),
    apiJson<{ ok: boolean; data?: MirrorPatternsData; error?: { message: string } }>("/api/mirror/patterns")
  ]);
  if (!ledgerBody.ok) throw new Error(ledgerBody.error?.message ?? "알 수 없는 오류");
  if (!patternsBody.ok) throw new Error(patternsBody.error?.message ?? "알 수 없는 오류");
  return { ledger: ledgerBody.data!, patterns: patternsBody.data! };
}

const OUTCOME_LABEL: Record<MirrorLedgerEntry["outcome"], string> = {
  moved: "이동",
  cancelled: "취소"
};

const EFFORT_LABEL: Record<string, string> = {
  none: "수고 없음",
  low: "수고 낮음",
  medium: "수고 보통",
  high: "수고 높음",
  unknown: "수고 미상"
};

export function MirrorLedger() {
  const [view, setView] = useState<ViewState>({ tag: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadMirrorData()
      .then((data) => {
        if (cancelled) return;
        const isEmpty = data.patterns.totals.annotations === 0;
        setView(isEmpty ? { tag: "quiet", data } : { tag: "live", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as Partial<AccessSessionError>;
        if (err.kind === "access_session_required") {
          setView({ tag: "access_session_required" });
        } else {
          setView({ tag: "error", message: e instanceof Error ? e.message : "오류" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view.tag === "loading") {
    return (
      <main className="app-shell" aria-label="거울 원장 불러오는 중">
        <div className="today-stack" aria-hidden="true">
          <div className="today-skel" />
          <div className="today-skel today-skel--delay" />
        </div>
      </main>
    );
  }

  if (view.tag === "access_session_required") {
    return (
      <main className="app-shell" aria-labelledby="mirror-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Mirror</p>
          <h1 id="mirror-title">로그인이 필요해</h1>
          <p>세션이 만료됐어. 페이지를 새로 고침해봐.</p>
          <button className="thread-index-new-btn" onClick={() => window.location.reload()}>새로 고침</button>
        </section>
      </main>
    );
  }

  if (view.tag === "error") {
    return (
      <main className="app-shell" aria-labelledby="mirror-title">
        <section className="quiet-card" role="alert">
          <p className="eyebrow">Mirror</p>
          <h1 id="mirror-title">불러오지 못했어</h1>
          <p>{view.message}</p>
          <button className="thread-index-new-btn" onClick={() => window.location.reload()}>다시 시도</button>
        </section>
      </main>
    );
  }

  if (view.tag === "quiet") {
    return (
      <main className="app-shell" aria-labelledby="mirror-title" data-testid="mirror-quiet">
        <section className="quiet-card warm">
          <span className="quiet-dot" aria-hidden="true" />
          <p className="eyebrow">Mirror</p>
          <h1 id="mirror-title">아직 기록된 이동/취소 원장이 없어</h1>
          <p>결정에 기록을 남기면 여기서 지난 이동과 취소를 그대로 비춰줄게.</p>
        </section>
      </main>
    );
  }

  const { data } = view;
  const { ledger, patterns } = data;
  return (
    <main className="app-shell today-live" aria-labelledby="mirror-title">
      <header style={{ width: "min(100%, 480px)", marginBottom: "12px" }}>
        <p className="eyebrow" style={{ margin: 0 }}>Mirror</p>
        <h1 id="mirror-title" style={{ margin: "4px 0 0" }}>이동·취소 원장</h1>
        <p className="card-meta" style={{ margin: "4px 0 0", opacity: 0.7 }}>
          {ledger.range.from} ~ {ledger.range.to} · 기록된 주석만 비춰
        </p>
      </header>

      <MirrorPatterns patterns={patterns} />

      <MirrorSummary data={ledger} />

      {ledger.sampleStatus === "low_sample" && (
        <p
          className="card-meta warm"
          role="note"
          data-testid="mirror-low-sample"
          style={{ width: "min(100%, 480px)", color: "var(--moved)", margin: "0 0 12px" }}
        >
          표본이 적어 패턴으로 보긴 이르다
        </p>
      )}

      <ul className="today-stack" role="list" data-testid="mirror-entries" style={{ width: "min(100%, 480px)" }}>
        {ledger.entries.map((entry) => (
          <MirrorEntryCard key={entry.annotationId} entry={entry} />
        ))}
      </ul>
    </main>
  );
}

function MirrorPatterns({ patterns }: { patterns: MirrorPatternsData }) {
  return (
    <section
      className="quiet-card warm"
      aria-label="기록 패턴"
      data-testid="mirror-patterns"
      style={{ width: "min(100%, 480px)", marginBottom: "12px" }}
    >
      <p className="eyebrow" style={{ margin: "0 0 8px" }}>기록 패턴</p>

      {patterns.sampleStatus === "low_sample" && (
        <p className="card-meta" role="note" data-testid="patterns-low-sample" style={{ margin: "0 0 8px", opacity: 0.7 }}>
          표본이 적어 패턴으로 보긴 이르다
        </p>
      )}

      <PatternGroup label="요일별" buckets={patterns.weekday} />
      <PatternGroup label="유형별" buckets={patterns.type} />
      <PatternGroup label="스레드별" buckets={patterns.thread} />
    </section>
  );
}

function PatternGroup({
  label,
  buckets
}: {
  label: string;
  buckets: Array<MirrorPatternBucket | MirrorPatternThreadBucket>;
}) {
  if (buckets.length === 0) return null;
  return (
    <div style={{ marginBottom: "8px" }}>
      <p className="card-meta" style={{ margin: "0 0 4px", fontWeight: 600 }}>{label}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {buckets.map((b) => (
          <li key={b.key} className="card-meta" style={{ margin: "2px 0", display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
            <span style={{ minWidth: "80px" }}>{b.label}</span>
            <span className="card-chip">
              {b.label} 기록 {b.total}건 중 이동/취소/지각 {b.slipCount}건
            </span>
            {b.sampleStatus === "low_sample" && (
              <span className="card-chip" style={{ opacity: 0.7 }}>표본 적음</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MirrorSummary({ data }: { data: MirrorLedgerData }) {
  const s = data.summary;
  return (
    <section
      className="quiet-card warm"
      aria-label="원장 요약"
      data-testid="mirror-summary"
      style={{ width: "min(100%, 480px)", marginBottom: "12px" }}
    >
      <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: 0 }}>
        <span className="card-chip">변경 {s.totalChanges}</span>
        <span className="card-chip">이동 {s.movedCount}</span>
        <span className="card-chip">취소 {s.cancelledCount}</span>
        <span className="card-chip">비용 없음 {s.freeCount}</span>
        <span className="card-chip">비용 있음 {s.paidCount}</span>
        <span className="card-chip">금전 {s.moneyTotal}</span>
        <span className="card-chip">관계 {s.socialTotal}</span>
      </p>
    </section>
  );
}

function MirrorEntryCard({ entry }: { entry: MirrorLedgerEntry }) {
  const { cost } = entry;
  return (
    <li className="today-card">
      <p className="card-chip" style={{ opacity: 0.8 }}>{OUTCOME_LABEL[entry.outcome]}</p>
      <p className="card-title">{entry.eventTitle}</p>
      <p className="card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "4px 0 0" }}>
        {cost.money > 0 && <span className="card-chip">금전 {cost.money}</span>}
        {cost.social > 0 && <span className="card-chip">관계 {cost.social}</span>}
        <span className="card-chip">{EFFORT_LABEL[cost.effort] ?? "수고 미상"}</span>
        {cost.window && <span className="card-chip">{cost.window}</span>}
        {!cost.hasAnyCost && <span className="card-chip">비용 없음</span>}
      </p>
      {(entry.reasonText || entry.reasonTags.length > 0) && (
        <p className="card-meta" style={{ margin: "4px 0 0", opacity: 0.7 }}>
          {entry.reasonText ?? entry.reasonTags.join(", ")}
        </p>
      )}
      <p className="card-meta" style={{ margin: "4px 0 0", opacity: 0.6 }}>
        {entry.loggedAt.slice(0, 10)}
        {entry.thread && (
          <>
            {" · "}
            <a href={`/threads/${entry.thread.id}`} className="thread-index-link">{entry.thread.name}</a>
          </>
        )}
      </p>
    </li>
  );
}
