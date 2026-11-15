import { useState, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import type { MirrorEnergyTrendDay, MirrorPatternBucket, MirrorPatternThreadBucket, MirrorTransitionFrictionDay } from "@cairn/shared";

// Charts for the statistics screen. Every figure drawn here is also in the table kept under
// "표로 보기" beside it, so nothing depends on hovering or on telling colours apart.

function shortDay(date: string): string {
  const [, m, d] = date.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : date;
}

// ── headline numbers ────────────────────────────────────────────────────────

export function StatTiles({ items, label }: { items: Array<{ label: string; value: string; note?: string }>; label: string }) {
  return (
    <dl className="stat-tiles" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className="stat-tile">
          <dt className="stat-tile-label">{item.label}</dt>
          <dd className="stat-tile-value">{item.value}</dd>
          {item.note && <dd className="stat-tile-note">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

// ── hover / focus read-out shared by the charts ─────────────────────────────

type Tip = { x: number; y: number; value: string; label: string };

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (value: string, label: string) => ({
    onPointerEnter: (e: PointerEvent<HTMLElement>) => place(e.currentTarget, value, label),
    onPointerMove: (e: PointerEvent<HTMLElement>) => place(e.currentTarget, value, label),
    onPointerLeave: () => setTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => place(e.currentTarget, value, label),
    onBlur: () => setTip(null)
  });
  const place = (el: HTMLElement, value: string, label: string) => {
    const host = el.closest<HTMLElement>(".chart");
    if (!host) return;
    const box = el.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    setTip({ x: Math.min(Math.max(box.left + box.width / 2 - frame.left, 60), Math.max(60, frame.width - 60)), y: box.top - frame.top, value, label });
  };
  const node: ReactNode = tip && (
    <div className="chart-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  );
  return { show, node };
}

function Legend({ items }: { items: Array<{ tone: "main" | "change" | "over"; label: string }> }) {
  return (
    <ul className="chart-legend" role="list">
      {items.map((item) => (
        <li key={item.label}><span className="chart-swatch" data-tone={item.tone} aria-hidden="true" />{item.label}</li>
      ))}
    </ul>
  );
}

// ── how the recorded events ended ───────────────────────────────────────────

type Bucket = MirrorPatternBucket | MirrorPatternThreadBucket;

// One row per group: the bar is as long as the group has records, split into what went as
// planned and what was moved, cancelled or late.
export function OutcomeBars({ title, buckets, nameOf }: { title: string; buckets: Bucket[]; nameOf?: (b: Bucket) => string }) {
  const { show, node } = useTip();
  if (buckets.length === 0) return null;
  const most = Math.max(...buckets.map((b) => b.total), 1);
  return (
    <figure className="chart chart-rows" aria-label={`${title} 결과`}>
      <figcaption className="chart-title">{title}</figcaption>
      <ul className="chart-row-list" role="list">
        {buckets.map((b) => {
          const name = nameOf ? nameOf(b) : b.label;
          const kept = b.total - b.slipCount;
          return (
            <li key={b.key} className="chart-row">
              <span className="chart-row-name">{name}</span>
              <span className="chart-row-track">
                <span className="chart-row-fill" style={{ width: `${(b.total / most) * 100}%` }}>
                  {kept > 0 && <span className="chart-seg" data-tone="main" style={{ flexGrow: kept }} tabIndex={0} aria-label={`${name} 그대로 진행 ${kept}건`} {...show(`${kept}건`, `${name} · 그대로 진행`)} />}
                  {b.slipCount > 0 && <span className="chart-seg" data-tone="change" style={{ flexGrow: b.slipCount }} tabIndex={0} aria-label={`${name} 이동·취소·지각 ${b.slipCount}건`} {...show(`${b.slipCount}건`, `${name} · 이동·취소·지각`)} />}
                </span>
              </span>
              <span className="chart-row-figure">
                {b.total}건{b.slipCount > 0 && <span className="chart-row-sub"> · 바뀜 {b.slipCount}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {node}
    </figure>
  );
}

export function OutcomeLegend() {
  return <Legend items={[{ tone: "main", label: "그대로 진행" }, { tone: "change", label: "이동·취소·지각" }]} />;
}

// ── daily load against the budget ───────────────────────────────────────────

const PLOT_PX = 120;

function hours(value: number): string {
  return `${Math.round(value * 10) / 10}시간`;
}

// A day far over the budget (an all-day block, say) would flatten every other column, so the
// scale stops at twice the budget; taller days are drawn to the top with their real figure on the cap.
export function EnergyColumns({ days, budget }: { days: MirrorEnergyTrendDay[]; budget: number }) {
  const { show, node } = useTip();
  const shown = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  if (shown.length === 0 || !(budget > 0)) return null;
  const top = Math.max(budget * 1.25, Math.min(Math.max(...shown.map((d) => d.loadUnits)), budget * 2));
  const budgetAt = (budget / top) * PLOT_PX;
  return (
    <figure className="chart chart-columns" aria-label="날짜별 부하와 예산">
      <figcaption className="chart-title">날짜별 부하</figcaption>
      <Legend items={[{ tone: "main", label: "예산 안" }, { tone: "over", label: "예산 초과" }]} />
      <div className="chart-plot" style={{ height: PLOT_PX }}>
        <span className="chart-ref" style={{ bottom: budgetAt }}><span className="chart-ref-label">예산 {hours(budget)}</span></span>
        {shown.map((d) => {
          const clipped = d.loadUnits > top;
          const height = Math.max(2, (Math.min(d.loadUnits, top) / top) * PLOT_PX);
          return (
            <span key={d.date} className="chart-col" tabIndex={0} aria-label={`${d.date} 부하 ${hours(d.loadUnits)}${d.deficit ? ", 예산 초과" : ""}`} {...show(hours(d.loadUnits), `${shortDay(d.date)}${d.deficit ? " · 예산 초과" : ""}`)}>
              {d.deficit && <span className="chart-col-value">{Math.round(d.loadUnits)}</span>}
              <span className="chart-col-bar" data-tone={d.deficit ? "over" : "main"} data-clipped={clipped ? "true" : undefined} style={{ height }} />
            </span>
          );
        })}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {shown.map((d) => <span key={d.date}>{shortDay(d.date)}</span>)}
      </div>
      {node}
    </figure>
  );
}

// ── switches between threads per day ────────────────────────────────────────

export function TransitionColumns({ days }: { days: MirrorTransitionFrictionDay[] }) {
  const { show, node } = useTip();
  const shown = [...days].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
  if (shown.length === 0) return null;
  const top = Math.max(...shown.map((d) => d.transitionPairs), 1);
  const plot = 72;
  return (
    <figure className="chart chart-columns" aria-label="날짜별 전환 횟수">
      <figcaption className="chart-title">날짜별 전환 횟수</figcaption>
      <div className="chart-plot" style={{ height: plot }}>
        {shown.map((d) => (
          <span key={d.date} className="chart-col" tabIndex={0} aria-label={`${d.date} 전환 ${d.transitionPairs}회`} {...show(`${d.transitionPairs}회`, `${shortDay(d.date)}${d.unknownTransitionPairs > 0 ? ` · 불확실 ${d.unknownTransitionPairs}` : ""}`)}>
            {d.transitionPairs === top && d.transitionPairs > 0 && <span className="chart-col-value">{d.transitionPairs}</span>}
            <span className="chart-col-bar" data-tone="main" data-empty={d.transitionPairs === 0 ? "true" : undefined} style={{ height: Math.max(2, (d.transitionPairs / top) * (plot - 18)) }} />
          </span>
        ))}
      </div>
      <div className="chart-axis" aria-hidden="true">
        {shown.map((d) => <span key={d.date}>{shortDay(d.date)}</span>)}
      </div>
      {node}
    </figure>
  );
}
